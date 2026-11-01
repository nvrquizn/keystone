import "dotenv/config";
import path from "node:path";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  DISCORD_TOKEN: required("DISCORD_TOKEN"),
  CLIENT_ID: required("CLIENT_ID"),
  GUILD_ID: required("GUILD_ID"),
  DATA_DIR: path.resolve(process.env.DATA_DIR?.trim() || "./data"),
};
