import { HasagiClient, LCUTypes } from "@hasagi/core";
import fs from "fs/promises";
import path from "path";
import { homedir } from "os";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function retry<T>(fn: () => T | Promise<T>, options?: { retries?: number, retryDelay?: number, initialDelay?: number, onSuccess?: (res: T) => void, onError?: (willRetry: boolean, err?: any) => void }): Promise<T> {
    const { retries = 3, retryDelay = 1000, initialDelay = 0, onSuccess, onError } = options ?? {};
    const errors: any[] = [];

    await delay(initialDelay);
    while (true) {
        try {
            const res = await fn();
            onSuccess?.(res);
            return res;
        } catch (e) {
            errors.push(e);
            onError?.(errors.length <= retries, e);
            if (errors.length > retries)
                throw new AggregateError(errors, `Failed to execute function in ${errors.length} attempt${errors.length !== 1 ? "s" : ""}.`);
        }

        await delay(retryDelay);
    }
}

const REPLAY_DIRECTORY = path.join(homedir(), "./Documents/League of Legends/Replays");
console.log(`Expecting replay directory to be at '${REPLAY_DIRECTORY}'.`);

const client = new HasagiClient();
let lastGameId = -1;

client.on("connecting", () => {
    console.log("Connecting to League client...")
});
client.on("connected", () => {
    console.log("Connected to League client.")
});
client.on("disconnected", () => {
    console.log("Disconnected from League client.")
    console.log("Reconnecting...")
    client.connect();
});

await client.connect();

client.addLCUEventListener({
    name: "OnJsonApiEvent_lol-end-of-game_v1_eog-stats-block",
    types: ["Create", "Update"],
    async callback(event) {
        const data = event.data as LCUTypes.LolEndOfGameEndOfGameStats;
        if (data.gameId && lastGameId !== data.gameId) {
            console.log(`Found completed game with id ${data.gameId}. Trying to download replay...`);
            lastGameId = data.gameId;

            await retry(async () => {
                await client.request("post", "/lol-replays/v1/rofls/{gameId}/download", {
                    path: { gameId: data.gameId as unknown as string },
                    body: { componentType: "replay-button_match-history" }
                });
            }, { initialDelay: 5000, retryDelay: 10000, retries: 2, onError: (willRetry, e) => console.log(`Failed to download replay (${e}).${willRetry ? " Retrying..." : ""}`), onSuccess: () => console.log("Downloading replay...") });

            const replayDirectory = await fs.readdir(REPLAY_DIRECTORY, { withFileTypes: true }).catch(() => null);
            if (!replayDirectory) {
                console.log(`Failed to find replay directory at ${REPLAY_DIRECTORY}.`);
                return;
            }

            // Periodically check if the download is complete
            const replayFile = await retry(() => replayDirectory.find(dirent => dirent.isFile() && dirent.name.endsWith(data.gameId + ".rofl")), { initialDelay: 5000, retryDelay: 5000, retries: 4 });
            if (!replayFile) {
                console.log(`Failed to find replay file for game ${data.gameId}.`);
                return;
            }

            console.log(`Found replay file '${replayFile.name}'.`);
        }
    },
})