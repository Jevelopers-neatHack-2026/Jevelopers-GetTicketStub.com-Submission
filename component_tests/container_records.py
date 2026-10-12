from pathlib import Path
from typing import Annotated, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field

PositiveId = Annotated[int, Field(gt=0)]


class Record(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True, extra="forbid")


class Role(Record):
    uid: PositiveId
    gid: PositiveId

    @property
    def docker_user(self) -> str:
        return f"{self.uid}:{self.gid}"


class Configuration(Record):
    producer: Path
    directory: Path
    name: Annotated[str, Field(pattern=r"^ie-lifetime-[a-f0-9]{32}$")]
    guard: Role = Role(uid=61001, gid=61001)
    owner: Role = Role(uid=61002, gid=61002)
    teardown_daemon_failure: bool = False


class Observation(Record):
    pid: PositiveId
    uid: PositiveId
    gid: PositiveId
    groups: tuple[int, ...]
    status: dict[str, str]
    namespaces: dict[str, str]
    cgroup: str
    apparmor: Literal["docker-default (enforce)"]


class GuardReceipt(Record):
    guard: Observation
    init: Observation
    lease_fd: PositiveId


class GuardConnection(Record):
    peer_pid: PositiveId
    receipt: GuardReceipt


class OwnerReceipt(Record):
    owner: Observation
    tamper: dict[str, int]


class DockerState(BaseModel):
    Running: bool
    Pid: int
    Status: Literal["created", "running", "paused", "restarting", "removing", "exited", "dead"]
    ExitCode: int


class DockerConfig(BaseModel):
    User: str
    Labels: dict[str, str]


class Mount(BaseModel):
    Type: str
    Source: str = ""
    Destination: str
    RW: bool


class Inspection(BaseModel):
    Id: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    Config: DockerConfig
    State: DockerState
    Mounts: tuple[Mount, ...]


class PinnedImage(BaseModel):
    image: str


def require_role(observed: Observation, role: Role) -> None:
    assert (observed.uid, observed.gid) == (role.uid, role.gid)
    assert set(observed.groups) <= {role.gid}
    for name in ("Uid", "Gid"):
        expected = role.uid if name == "Uid" else role.gid
        assert tuple(map(int, observed.status[name].split())) == (expected,) * 4
    for name in ("CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"):
        assert int(observed.status[name], 16) == 0
    assert observed.status["NoNewPrivs"] == "1"
    assert observed.status["Seccomp"] == "2"
    assert int(observed.status["Seccomp_filters"]) >= 1
