#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

int main(void) {
  char line[256];
  int address_limit_ok = 0;
  int descriptor_limit_ok = 0;
  int cpu_limit_ok = 0;
  int core_limit_ok = 0;
  FILE *limits = fopen("/proc/self/limits", "r");
  if (limits == NULL) return 10;
  while (fgets(line, sizeof(line), limits) != NULL) {
    if (strncmp(line, "Max address space", 17) == 0 && strstr(line, "6442450944") != NULL) {
      address_limit_ok = 1;
    }
    if (strncmp(line, "Max open files", 14) == 0 && strstr(line, "64 64") != NULL) {
      descriptor_limit_ok = 1;
    }
    if (strncmp(line, "Max CPU time", 12) == 0 && strstr(line, "15 15") != NULL) {
      cpu_limit_ok = 1;
    }
    if (strncmp(line, "Max core file size", 18) == 0 && strstr(line, "0 0") != NULL) {
      core_limit_ok = 1;
    }
  }
  fclose(limits);

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
  printf("as=6442450944 blocked=%d nofile=64 blocked=%d cpu=15 core=0\n",
         address_limit_ok && address_space_blocked,
         descriptor_limit_ok && descriptors_blocked);
  for (int descriptor = 3; descriptor < 3 + opened; descriptor += 1) close(descriptor);
  return address_limit_ok && descriptor_limit_ok && cpu_limit_ok && core_limit_ok &&
                 address_space_blocked && descriptors_blocked
             ? 0
             : 11;
}
