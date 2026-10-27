#include <cstddef>

// main.cpp is built with -fsanitize=kernel-address and every check as a call => each load lands here; trace.py reads the buffer at each step (§19.9.2)
// built once in the image without the sanitizer, or each hook would call itself
extern "C" {
unsigned long viz_reads_count;
const void *viz_reads[4096];
}

static void read_at(const void *p) {
    unsigned long n = viz_reads_count++;
    if (n < sizeof viz_reads / sizeof *viz_reads)
        viz_reads[n] = p;
}

#define SIZE(n)                                                \
    extern "C" void __asan_load##n(const void *p) { read_at(p); } \
    extern "C" void __asan_load##n##_noabort(const void *p) { read_at(p); } \
    extern "C" void __asan_store##n(const void *) {}            \
    extern "C" void __asan_store##n##_noabort(const void *) {}

SIZE(1)
SIZE(2)
SIZE(4)
SIZE(8)
SIZE(16)

extern "C" void __asan_loadN(const void *p, long) { read_at(p); }
extern "C" void __asan_loadN_noabort(const void *p, long) { read_at(p); }
extern "C" void __asan_storeN(const void *, long) {}
extern "C" void __asan_storeN_noabort(const void *, long) {}
extern "C" void __asan_handle_no_return() {}
extern "C" void __asan_before_dynamic_init(const void *) {}
extern "C" void __asan_after_dynamic_init() {}
