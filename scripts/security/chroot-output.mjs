export function classifyChrootOutput(result) {
	if (result.error || result.signal) return "PROBE_EXECUTION_FAILURE";
	if (
		/^\/usr\/sbin\/chroot: cannot change root directory to ['\u2018]\/proc\/self\/fdinfo\/['\u2019]: Operation not permitted\s*$/.test(
			result.stderr,
		)
	)
		return "CHROOT_EPERM";
	if (
		/^\/usr\/sbin\/chroot: failed to run command ['\u2018]\/usr\/bin\/true['\u2019]: No such file or directory\s*$/.test(
			result.stderr,
		)
	)
		return "CHROOT_ENTERED_FDINFO";
	return "UNKNOWN_FAILURE";
}
