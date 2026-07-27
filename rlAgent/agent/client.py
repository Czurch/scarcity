import json
import subprocess
import sys


class GameClient:
    """Spawns the game server as a subprocess and communicates over STDIN/STDOUT."""

    def __init__(self, server_cmd: str):
        self.proc = subprocess.Popen(
            server_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=sys.stderr,
            text=True,
            bufsize=1,      # line-buffered so messages arrive immediately
            shell=True,     # needed on Windows where npx is npx.cmd
        )

    def recv(self) -> dict | None:
        line = self.proc.stdout.readline()
        if not line:
            return None
        return json.loads(line.strip())

    def send(self, msg: dict) -> None:
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()

    def close(self) -> None:
        self.proc.stdin.close()
        self.proc.wait()
