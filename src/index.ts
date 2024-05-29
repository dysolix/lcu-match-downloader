import { HasagiClient, LCUEndpointResponseType } from "@hasagi/core";
import fs from "fs/promises";

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
const REPLAY_DIRECTORY = await client.request("get", "/lol-replays/v1/rofls/path");
console.log(`Replay directory is ${REPLAY_DIRECTORY}.`);

client.addLCUEventListener({
    name: "OnJsonApiEvent_lol-end-of-game_v1_eog-stats-block",
    path: "/lol-end-of-game/v1/eog-stats-block",
    types: ["Create", "Update"],
    async callback(event) {
        const data = event.data as LCUEndpointResponseType<"get", "/lol-end-of-game/v1/eog-stats-block">;
        if (data.gameId && lastGameId !== data.gameId) {
            console.log(`Found completed game with id ${data.gameId}. Trying to download replay...`);
            lastGameId = data.gameId;

            await retry(async () => {
                await client.request("post", "/lol-replays/v1/rofls/{gameId}/download", {
                    path: { gameId: data.gameId as unknown as string },
                    body: { componentType: "replay-button_match-history" }
                });
            }, { initialDelay: 5000, retryDelay: 10000, retries: 2, onError: (willRetry, e) => console.log(`Failed to download replay (${e}).${willRetry ? " Retrying..." : ""}`), onSuccess: () => console.log("Downloading replay...") });

            // Wait for download to finish
            const replayFile = await retry(async () => {
                const metadata = await client.request("get", "/lol-replays/v1/metadata/{gameId}", { path: { gameId: data.gameId as any } });
                if (metadata.state === "downloading")
                    throw new Error("Replay is still downloading...");

                if (metadata.state !== "watch")
                    throw new Error(`Replay is in an unexpected state. (${metadata.state})`);

                const replayDirectory = await fs.readdir(REPLAY_DIRECTORY, { withFileTypes: true }).catch(() => null);
                if (!replayDirectory) {
                    throw new Error(`Couldn't access replay directory at ${REPLAY_DIRECTORY}.`);
                }

                const file = replayDirectory.find(dirent => dirent.isFile() && dirent.name.endsWith(data.gameId + ".rofl"));
                if (file)
                    return file;

                throw new Error("Couldn't find replay file.");
            }, { initialDelay: 5000, retryDelay: 5000, retries: 4 }).catch(() => null);
            if (!replayFile) {
                console.log(`Failed to download replay for game ${data.gameId}.`);
                return;
            }

            console.log(`Downloaded replay file '${replayFile.name}'.`);
        }
    },
})