import json
from pathlib import Path

from component_tests.container_docker import Docker
from component_tests.container_facts import facts
from component_tests.container_records import (
    GuardConnection,
    Observation,
    OwnerReceipt,
    require_role,
)


def bind_guard(docker: Docker, identity: str, connection: GuardConnection) -> None:
    receipt = connection.receipt
    inspection = docker.inspect(identity)
    host_init = Observation.model_validate(facts(inspection.State.Pid))
    host_guard = Observation.model_validate(facts(connection.peer_pid))
    creator = facts()
    for name in ("pid", "mnt", "net", "ipc"):
        assert host_guard.namespaces[name] != creator["namespaces"][name]
    for observed in (host_init, host_guard, receipt.guard, receipt.init):
        require_role(observed, docker.configuration.guard)
        assert observed.namespaces == receipt.guard.namespaces
    assert receipt.guard.status["PPid"] == "1"
    assert host_guard.status["PPid"] == str(host_init.pid)
    assert host_guard.status["NSpid"].split()[-1] == str(receipt.guard.pid)
    assert host_guard.cgroup == host_init.cgroup
    assert receipt.guard.cgroup == receipt.init.cgroup
    _ = (docker.configuration.directory / "guard-binding.json").write_text(
        json.dumps(
            {
                "host_init": host_init.model_dump(),
                "host_guard": host_guard.model_dump(),
                "creator_namespaces": creator["namespaces"],
                "container": receipt.model_dump(),
                "full_id": identity,
            },
            indent=2,
        )
    )


def bind_owner(docker: Docker, identity: str, receipt: OwnerReceipt) -> None:
    top = docker.run(("top", identity, "-eo", "pid"))
    _ = (docker.configuration.directory / "docker-top.txt").write_bytes(top)
    observations = tuple(
        Observation.model_validate(facts(int(line))) for line in top.decode().splitlines()[1:]
    )
    owners = tuple(
        item for item in observations if item.status["NSpid"].split()[-1] == str(receipt.owner.pid)
    )
    assert len(owners) == 1
    host_owner = owners[0]
    assert host_owner.status["State"].split()[0] in {"R", "S"}
    descriptors = tuple(path.name for path in Path(f"/proc/{host_owner.pid}/fd").iterdir())
    assert not {"0", "1", "2"}.intersection(descriptors)
    require_role(receipt.owner, docker.configuration.owner)
    require_role(host_owner, docker.configuration.owner)
    assert host_owner.namespaces == receipt.owner.namespaces
    inits = tuple(item for item in observations if item.status["NSpid"].split()[-1] == "1")
    assert len(inits) == 1
    init = inits[0]
    assert host_owner.namespaces == init.namespaces
    assert host_owner.cgroup == init.cgroup
    _ = (docker.configuration.directory / "owner-binding.json").write_text(
        json.dumps(
            {
                "host_owner": host_owner.model_dump(),
                "container": receipt.model_dump(),
                "full_id": identity,
                "open_descriptors": descriptors,
            },
            indent=2,
        )
    )
