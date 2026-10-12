import json
import subprocess
from time import monotonic

from component_tests.container_docker import Docker


def reap_clients(docker: Docker, clients: list[subprocess.Popen[bytes]]) -> bool:
    try:
        for client in clients:
            try:
                _ = client.communicate(timeout=max(0.001, docker.deadline - monotonic()))
            except subprocess.TimeoutExpired:
                client.kill()
                _ = client.communicate(timeout=max(0.001, docker.deadline - monotonic()))
    except (OSError, subprocess.SubprocessError) as error:
        _ = (docker.configuration.directory / "client-error.txt").write_text(type(error).__name__)
        return False
    return True


def recover(docker: Docker, identity: str | None, *, completed: bool = False) -> str:
    inspected = docker.inspect(identity or docker.configuration.name)
    identity = inspected.Id
    if inspected.State.Running:
        _ = docker.run(("wait", identity))
    final = docker.inspect(identity)
    assert not final.State.Running
    assert final.State.Status in {"exited", "created"}
    if completed:
        assert final.State.Status == "exited"
        assert final.State.ExitCode == 0
    _ = docker.run(("rm", identity))
    remaining = docker.run(("ps", "-aq", "--no-trunc", "--filter", f"id={identity}"))
    assert remaining.strip() == b""
    return identity


def finish(docker: Docker, identity: str | None, *, completed: bool = False) -> bool:
    try:
        if docker.configuration.teardown_daemon_failure:
            _ = subprocess.run(  # noqa: S603 - unavailable per-client socket, no daemon mutation
                (
                    docker.executable,
                    "--host",
                    f"unix://{docker.configuration.directory}/absent.sock",
                    "inspect",
                    identity or docker.configuration.name,
                ),
                check=True,
                capture_output=True,
                timeout=1,
            )
        _ = recover(docker, identity, completed=completed)
    except (AssertionError, OSError, subprocess.SubprocessError, ValueError) as error:
        _ = (docker.configuration.directory / "quarantine.json").write_text(
            json.dumps(
                {
                    "full_id": identity,
                    "reason": type(error).__name__,
                    "staging_preserved": True,
                }
            )
        )
        return False
    return True
