import os
import subprocess
import sys
from _thread import interrupt_main
from pathlib import Path
from threading import Event, Timer

import pytest

from integration_evals.processes import ProcessSettings, invoke


@pytest.mark.parametrize("finish", ["success", "timeout"])
@pytest.mark.parametrize("detached", [False, True])
@pytest.mark.parametrize("depth", [1, 2])
def test_descendants_stop_when_owner_invocation_ends(
    tmp_path: Path, finish: str, depth: int, *, detached: bool
) -> None:
    # Given an owner attempting to create a descendant that outlives its leader.
    marker = tmp_path / "survived"
    child = (
        "from pathlib import Path; import time; "
        f"print('ready',flush=True); time.sleep(1); Path({str(marker)!r}).write_text('survived')"
    )
    if depth == 2:
        child = (
            "import subprocess,sys; "
            f"p=subprocess.Popen([sys.executable,'-c',{child!r}],"
            "start_new_session=True,stdout=subprocess.PIPE); "
            "print(p.stdout.readline().decode().strip(),flush=True)"
        )
    program = "\n".join(
        (
            "import subprocess,sys,signal",
            "try:",
            (
                f" child=subprocess.Popen([sys.executable,'-c',{child!r}],"
                f"start_new_session={detached!r},stdout=subprocess.PIPE)"
            ),
            " child.stdout.readline()",
            " print('spawned',flush=True)",
            "except PermissionError:",
            " print('fork-denied',flush=True)",
            "signal.pause()" if finish == "timeout" else "sys.exit(0)",
        )
    )
    output = tmp_path / "stdout"
    with output.open("w+b") as handle:
        settings = ProcessSettings(tmp_path, os.environ, b"", handle, 0.25)
        # When the owner finishes or reaches its deadline.
        if finish == "timeout":
            with pytest.raises(subprocess.TimeoutExpired):
                _ = invoke((sys.executable, "-c", program), settings)
        else:
            assert invoke((sys.executable, "-c", program), settings) == 0
    # Then Linux children cannot survive namespace teardown; macOS denies all forks.
    expected = "fork-denied" if sys.platform == "darwin" else "spawned"
    assert output.read_text(encoding="utf-8").strip() == expected
    _ = Event().wait(1.1)
    assert not marker.exists()


def test_process_namespace_stops_when_invocation_is_cancelled(tmp_path: Path) -> None:
    # Given a real long-lived owner invocation.
    timer = Timer(0.25, interrupt_main)
    settings = ProcessSettings(tmp_path, os.environ, b"", subprocess.DEVNULL, 3)
    timer.start()
    try:
        # When this test's invocation receives cancellation.
        with pytest.raises(KeyboardInterrupt):
            _ = invoke((sys.executable, "-c", "import signal; signal.pause()"), settings)
    finally:
        timer.cancel()
        timer.join()
    # Then cancellation is propagated after task-owned resources are reaped.
