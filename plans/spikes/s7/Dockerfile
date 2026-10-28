# The runner image plus a third precompiled header, for build E: _GLIBCXX_ASSERTIONS instead of _GLIBCXX_DEBUG, and UBSan
# without its per-access checks. flags = manifest.yaml build.cmd + E's safety flags; gcc picks the .gch whose macros match
FROM viz-runner-cpp:13.5-gdb14-1
RUN cd "/usr/local/include/c++/$(g++ -dumpfullversion)/$(g++ -dumpmachine)/bits" \
    && g++ -std=gnu++17 -O0 -g3 -fno-omit-frame-pointer --coverage -Wall -Wextra -Wshadow -fdiagnostics-plain-output \
        -D_GLIBCXX_ASSERTIONS -fsanitize=undefined -fno-sanitize=null,alignment,pointer-overflow -fno-sanitize-recover=all \
        -x c++-header stdc++.h -o stdc++.h.gch/checks-assert.gch \
    && rm stdc++.h.gch/*.gcno
