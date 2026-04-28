from gymnasium.envs.registration import register

register(
    id="Bloxorz-v0",
    entry_point="src.envs.bloxorz_env:BloxorzEnv",
)
