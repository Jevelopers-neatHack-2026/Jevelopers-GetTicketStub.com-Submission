#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <unistd.h>

int main(void) {
  struct rlimit address_limit;
  struct rlimit descriptor_limit;
  struct rlimit cpu_limit;
  struct rlimit core_limit;
  if (getrlimit(RLIMIT_AS, &address_limit) != 0 ||
      getrlimit(RLIMIT_NOFILE, &descriptor_limit) != 0 ||
      getrlimit(RLIMIT_CPU, &cpu_limit) != 0 ||
      getrlimit(RLIMIT_CORE, &core_limit) != 0) {
    return 10;
  }

  const int address_limit_ok = address_limit.rlim_cur == 6442450944ULL &&
                               address_limit.rlim_max == 6442450944ULL;
  const int descriptor_limit_ok = descriptor_limit.rlim_cur == 64 &&
                                  descriptor_limit.rlim_max == 64;
  const int cpu_limit_ok = cpu_limit.rlim_cur == 15 && cpu_limit.rlim_max == 15;
  const int core_limit_ok = core_limit.rlim_cur == 0 && core_limit.rlim_max == 0;

  const size_t allocation_size = (size_t)7 * 1024 * 1024 * 1024;
  void *region = mmap(NULL, allocation_size, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  const int address_space_blocked = region == MAP_FAILED && errno == ENOMEM;
  if (region != MAP_FAILED) munmap(region, allocation_size);

  int opened = 0;
  while (opened < 128) {
    const int descriptor = open("/dev/null", O_RDONLY);
    if (descriptor < 0) break;
    opened += 1;
  }
  const int descriptors_blocked = errno == EMFILE && opened <= 64;
  printf("as=%d nofile=%d cpu=%d core=%d as_map_blocked=%d fd_blocked=%d\n",
         address_limit_ok, descriptor_limit_ok, cpu_limit_ok, core_limit_ok,
         address_space_blocked, descriptors_blocked);
  for (int descriptor = 3; descriptor < 3 + opened; descriptor += 1) close(descriptor);
  return address_limit_ok && descriptor_limit_ok && cpu_limit_ok && core_limit_ok &&
                 address_space_blocked && descriptors_blocked
             ? 0
             : 11;
}
