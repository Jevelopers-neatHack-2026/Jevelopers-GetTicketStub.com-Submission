import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from integration_evals.errors import fail
from integration_evals.processes import ProcessSettings, invoke


@pytest.mark.parametrize("finish", ["success", "timeout"])
def test_descendants_stop_when_owner_invocation_ends(tmp_path: Path, finish: str) -> None:
    # Given a task-owned process that creates an idle descendant.
    child = "import signal; signal.pause()"
    program = "; ".join(
        (
            "import subprocess,sys,signal",
            f"child=subprocess.Popen([sys.executable,'-c',{child!r}])",
            "print(child.pid,flush=True)",
            "signal.pause()" if finish == "timeout" else "sys.exit(0)",
        )
    )
    output = tmp_path / "stdout"
    with output.open("w+b") as handle:
        settings = ProcessSettings(tmp_path, os.environ, b"", handle, 1)
        # When the owner finishes or reaches its deadline.
        if finish == "timeout":
            with pytest.raises(subprocess.TimeoutExpired):
                _ = invoke((sys.executable, "-c", program), settings)
        else:
            assert invoke((sys.executable, "-c", program), settings) == 0
    descendant = int(output.read_text(encoding="utf-8").strip())
    ps = shutil.which("ps")
    if ps is None:
        fail("ps_runtime_missing", "process-test")
    state = subprocess.run(  # noqa: S603 - inspect only the PID created by this test
        (ps, "-o", "stat=", "-p", str(descendant)),
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    ).stdout.strip()
    # Then no descendant can continue work; a terminated zombie may await init reaping.
    assert not state or state.startswith("Z"), state
