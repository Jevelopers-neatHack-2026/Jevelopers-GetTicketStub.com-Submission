import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from time import monotonic, monotonic_ns

from pydantic import TypeAdapter

from component_tests.container_records import Configuration, Inspection, PinnedImage
from integration_evals.print_setup import verify_source
from integration_evals.validation import git_value


@dataclass(frozen=True, slots=True)
class Docker:
    configuration: Configuration
    deadline: float

    @property
    def executable(self) -> str:
        executable = shutil.which("docker")
        assert executable is not None
        return executable

    def run(self, arguments: tuple[str, ...]) -> bytes:
        remaining = self.deadline - monotonic()
        assert remaining > 0, "Invocation budget exhausted"
        return subprocess.run(  # noqa: S603 - fixed Docker executable, isolated argv
            (self.executable, *arguments),
            check=True,
            capture_output=True,
            timeout=remaining,
        ).stdout

    def inspect(self, identity: str) -> Inspection:
        raw = self.run(("inspect", identity))
        attempt = self.configuration.directory / f"inspection-{monotonic_ns()}"
        _ = attempt.with_suffix(".raw.json").write_bytes(raw)
        _ = attempt.with_suffix(".request.json").write_text(json.dumps({"identity": identity}))
        inspections = TypeAdapter(tuple[Inspection, ...]).validate_json(raw)
        assert len(inspections) == 1
        result = inspections[0]
        if len(identity) == 64:
            assert result.Id == identity
        assert result.Config.Labels.get("integration-evals.lifetime") == self.configuration.name
        assert result.Config.User == self.configuration.guard.docker_user
        destination = self.configuration.directory / f"inspect-{result.State.Status}.json"
        _ = destination.write_bytes(raw)
        node = self.configuration.producer / "out/toolchain/node-v24.21.0-linux-x64/bin/node"
        validator = self.configuration.producer / "scripts/security/run-offline.mjs"
        payload = (
            b'{"inspection":'
            + raw.strip()[1:-1]
            + b',"user":'
            + json.dumps(
                self.configuration.guard.docker_user,
            ).encode()
            + b"}"
        )
        receipt = subprocess.run(  # noqa: S603 - actual pinned producer validator
            (str(node), str(validator), "--check-inspection"),
            input=payload,
            check=True,
            capture_output=True,
            timeout=max(0.001, self.deadline - monotonic()),
        )
        _ = (
            self.configuration.directory / f"source-inspection-{result.State.Status}.json"
        ).write_bytes(
            receipt.stdout,
        )
        expected = {target: (str(source), writable) for source, target, writable in self.mounts()}
        binds = {
            mount.Destination: (mount.Source, mount.RW)
            for mount in result.Mounts
            if mount.Type == "bind"
        }
        assert binds == expected
        assert all(
            mount.Type == "bind" or (mount.Type == "tmpfs" and mount.Destination == "/tmp")  # noqa: S108 - exact source tmpfs target
            for mount in result.Mounts
        )
        return result

    def mounts(self) -> tuple[tuple[Path, str, bool], ...]:
        directory = self.configuration.directory
        return (
            (directory / "code", "/prototype/component_tests", False),
            (Path(sys.base_prefix), sys.base_prefix, False),
            (self.configuration.producer, "/producer", False),
            (directory / "owner", "/owner", True),
            (directory / "control", "/run/ie-control", False),
            (directory / "security", "/run/pp-security", False),
        )

    def create_arguments(self) -> tuple[str, ...]:
        config = self.configuration
        profile = Path(__file__).resolve().parents[1] / "src/integration_evals/print-profile.json"
        image = PinnedImage.model_validate_json(profile.read_bytes()).image
        policy = config.producer / "scripts/security/playwright-1.64.0.chromium-chroot.seccomp"
        mounts = tuple(
            argument
            for source, target, writable in self.mounts()
            for argument in (
                "--mount",
                f"type=bind,source={source},target={target}" + ("" if writable else ",readonly"),
            )
        )
        return (
            "create",
            "--name",
            config.name,
            "--label",
            f"integration-evals.lifetime={config.name}",
            "--cidfile",
            str(config.directory / "cid"),
            "--platform",
            "linux/amd64",
            "--init",
            "--user",
            config.guard.docker_user,
            "--network",
            "none",
            "--ipc",
            "private",
            "--shm-size",
            "1g",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--security-opt",
            "apparmor=docker-default",
            "--security-opt",
            f"seccomp={policy}",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,nosuid,nodev,size=2g,mode=1777",  # noqa: S108 - unchanged print-ci tmpfs
            "--log-driver",
            "none",
            *mounts,
            "--workdir",
            "/prototype",
            image,
            str(Path(sys.base_prefix) / "bin/python3.13"),
            "-B",
            "-m",
            "component_tests.container_guard",
        )


def prepare(configuration: Configuration) -> None:
    assert configuration.guard.uid != configuration.owner.uid
    assert configuration.guard.gid != configuration.owner.gid
    directory = configuration.directory
    directory.mkdir(mode=0o700)
    repository = Path(__file__).resolve().parents[1]
    profile = verify_source(repository, configuration.producer)
    assert git_value(configuration.producer, "status", "--porcelain") == ""
    _ = (directory / "source-pins.json").write_text(profile.model_dump_json(indent=2))
    for name in ("control", "owner", "security", "code"):
        (directory / name).mkdir(mode=0o755)
    for name, role in (("control", configuration.guard), ("owner", configuration.owner)):
        os.chown(directory / name, role.uid, role.gid)
        (directory / name).chmod(0o700)
    for name in ("container_facts.py", "container_guard.py", "container_canary.py"):
        _ = shutil.copyfile(Path(__file__).with_name(name), directory / "code" / name)
    _ = (directory / "code-hashes.json").write_text(
        json.dumps(
            {
                path.name: sha256(path.read_bytes()).hexdigest()
                for path in (directory / "code").iterdir()
            }
        )
    )
    _ = (directory / "security/host-namespaces.json").write_text(
        json.dumps({name: str(Path(f"/proc/self/ns/{name}").readlink()) for name in ("ipc", "net")})
    )
    _ = (directory / "configuration.json").write_text(configuration.model_dump_json(indent=2))
