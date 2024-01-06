import fs from "fs/promises";
import path from "path";
import { homedir } from "os";

const gameid = "6754285335"
const WINDOWS_REPLAY_DIRECTOY = path.join(homedir(), "./Documents/League of Legends/Replays");
console.log(`Expecting replay directory to be at '${WINDOWS_REPLAY_DIRECTOY}'.`);
const replayDirectory = await fs.readdir(WINDOWS_REPLAY_DIRECTOY, { withFileTypes: true }).catch(() => null);
if (!replayDirectory) {
    console.log(`Failed to find replay directory at ${WINDOWS_REPLAY_DIRECTOY}.`);
}

const replayFile = replayDirectory?.find(dirent => dirent.isFile() && dirent.name.endsWith(gameid + ".rofl"));
if (!replayFile) {
    console.log(`Failed to find replay file for game ${gameid}.`);
}

if (replayFile)
    console.log(`Found replay file ${replayFile.name}.`);