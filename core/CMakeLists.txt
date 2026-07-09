cmake_minimum_required(VERSION 3.20)

file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../VERSION" CBERG_VERSION_RAW)
string(STRIP "${CBERG_VERSION_RAW}" CBERG_VERSION)
string(REGEX REPLACE "^v" "" CBERG_VERSION_NUMERIC "${CBERG_VERSION}")

project(codeberg-core VERSION "${CBERG_VERSION_NUMERIC}" LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_C_VISIBILITY_PRESET hidden)
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

set(TS_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/tree-sitter)
set(GRAMMAR_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/grammars)

if(NOT EXISTS ${TS_DIR}/lib/src/lib.c)
  message(FATAL_ERROR "tree-sitter submodule missing; run: git submodule update --init --recursive")
endif()

add_library(treesitter_runtime OBJECT ${TS_DIR}/lib/src/lib.c)
target_include_directories(treesitter_runtime PRIVATE ${TS_DIR}/lib/src PUBLIC ${TS_DIR}/lib/include)
set_target_properties(treesitter_runtime PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_compile_options(treesitter_runtime PRIVATE -w)

set(CBERG_GRAMMAR_OBJECTS "")
function(cberg_add_grammar dir)
  cmake_parse_arguments(G "" "SUBDIR;SCANNER" "" ${ARGN})
  set(src_root ${GRAMMAR_DIR}/${dir})
  if(G_SUBDIR)
    set(src_root ${src_root}/${G_SUBDIR})
  endif()
  set(target "grammar_${dir}")
  if(G_SUBDIR)
    string(REPLACE "/" "_" suffix "${G_SUBDIR}")
    set(target "grammar_${dir}_${suffix}")
  endif()
  set(sources ${src_root}/src/parser.c)
  if(G_SCANNER)
    list(APPEND sources ${src_root}/src/${G_SCANNER})
  endif()
  add_library(${target} OBJECT ${sources})
  target_include_directories(${target} PRIVATE ${src_root}/src)
  set_target_properties(${target} PROPERTIES POSITION_INDEPENDENT_CODE ON)
  target_compile_options(${target} PRIVATE -w)
  set(CBERG_GRAMMAR_OBJECTS ${CBERG_GRAMMAR_OBJECTS} $<TARGET_OBJECTS:${target}> PARENT_SCOPE)
endfunction()

cberg_add_grammar(tree-sitter-go)
cberg_add_grammar(tree-sitter-c)
cberg_add_grammar(tree-sitter-java)
cberg_add_grammar(tree-sitter-javascript SCANNER scanner.c)
cberg_add_grammar(tree-sitter-python SCANNER scanner.c)
cberg_add_grammar(tree-sitter-kotlin SCANNER scanner.c)
cberg_add_grammar(tree-sitter-typescript SUBDIR typescript SCANNER scanner.c)
cberg_add_grammar(tree-sitter-rust SCANNER scanner.c)
cberg_add_grammar(tree-sitter-ruby SCANNER scanner.c)

if(APPLE)
  set(CBERG_WATCH_PLATFORM_SRC src/watch/watch_fsevents.c)
elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  set(CBERG_WATCH_PLATFORM_SRC src/watch/watch_inotify.c)
else()
  set(CBERG_WATCH_PLATFORM_SRC src/watch/watch_poll.c)
endif()

set(CBERG_SOURCES
  src/common/status.c
  src/common/version.c
  src/common/lang.c
  src/common/arena.c
  src/common/config.c
  src/common/hash.c
  src/common/pathutil.c
  src/common/walk_policy.c
  src/common/fileio.c
  src/common/strutil.c
  src/common/strmap.c
  src/common/u64map.c
  third_party/xxhash.c
  src/chunk/chunk_keys.c
  src/chunk/chunk_kind.c
  src/chunk/chunker.c
  src/chunk/chunk_table.c
  src/manifest/manifest.c
  src/watch/watch.c
  src/watch/watch_walk.c
  ${CBERG_WATCH_PLATFORM_SRC}
  src/embed/embed.c
  src/search/index_config.c
  src/search/search.c
)

find_path(ONNXRUNTIME_INCLUDE_DIR
  NAMES onnxruntime_c_api.h
  HINTS ${ONNXRUNTIME_ROOT} /opt/homebrew/opt/onnxruntime /usr/local /opt/homebrew /usr
  PATH_SUFFIXES include/onnxruntime include)
find_library(ONNXRUNTIME_LIB
  NAMES onnxruntime
  HINTS ${ONNXRUNTIME_ROOT} /opt/homebrew/opt/onnxruntime /usr/local /opt/homebrew /usr
  PATH_SUFFIXES lib)
if(ONNXRUNTIME_INCLUDE_DIR AND ONNXRUNTIME_LIB)
  set(CBERG_WITH_ONNX ON)
  list(APPEND CBERG_SOURCES src/embed/embed_onnx.c src/embed/tokenize.c)
  message(STATUS "codeberg: ONNX embedding enabled (${ONNXRUNTIME_LIB})")

  set(OCOS_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/onnxruntime-extensions)
  if(NOT EXISTS ${OCOS_DIR}/shared/api/tokenizer_impl.cc)
    message(FATAL_ERROR "onnxruntime-extensions submodule missing; run: git submodule update --init --recursive")
  endif()

  set(OCOS_ORT_SHIM ${CMAKE_CURRENT_BINARY_DIR}/ort_pkg_shim)
  file(MAKE_DIRECTORY ${OCOS_ORT_SHIM})
  get_filename_component(ONNX_LIBDIR_FOR_SHIM "${ONNXRUNTIME_LIB}" DIRECTORY)
  file(CREATE_LINK ${ONNXRUNTIME_INCLUDE_DIR} ${OCOS_ORT_SHIM}/include SYMBOLIC)
  file(CREATE_LINK ${ONNX_LIBDIR_FOR_SHIM} ${OCOS_ORT_SHIM}/lib SYMBOLIC)
  set(ONNXRUNTIME_PKG_DIR ${OCOS_ORT_SHIM} CACHE PATH "ORT pkg for onnxruntime-extensions" FORCE)

  set(OCOS_ENABLE_C_API ON CACHE BOOL "" FORCE)
  set(OCOS_ENABLE_GPT2_TOKENIZER ON CACHE BOOL "" FORCE)
  foreach(_t TRIE SPM WORDPIECE BERT)
    set(OCOS_ENABLE_${_t}_TOKENIZER OFF CACHE BOOL "" FORCE)
  endforeach()
  foreach(_g MATH DLIB BLINGFIRE VISION AUDIO TF_STRING RE2_REGEX)
    set(OCOS_ENABLE_${_g} OFF CACHE BOOL "" FORCE)
  endforeach()
  set(OCOS_BUILD_SHARED_LIB OFF CACHE BOOL "" FORCE)
  set(OCOS_ENABLE_PYTHON OFF CACHE BOOL "" FORCE)
  set(OCOS_ENABLE_CTEST OFF CACHE BOOL "" FORCE)
  add_subdirectory(${OCOS_DIR} ${CMAKE_CURRENT_BINARY_DIR}/onnxruntime-extensions EXCLUDE_FROM_ALL)
else()
  message(STATUS "codeberg: ONNX Runtime not found; local ONNX embedding disabled")
endif()

set(USEARCH_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/usearch)
if(EXISTS ${USEARCH_DIR}/c/lib.cpp)
  set(CBERG_WITH_USEARCH ON)
  add_library(usearch_c OBJECT ${USEARCH_DIR}/c/lib.cpp)
  target_include_directories(usearch_c PRIVATE ${USEARCH_DIR}/include ${USEARCH_DIR}/c)
  target_compile_definitions(usearch_c PRIVATE USEARCH_USE_SIMSIMD=0 USEARCH_USE_FP16LIB=0 USEARCH_USE_OPENMP=0)
  set_target_properties(usearch_c PROPERTIES POSITION_INDEPENDENT_CODE ON CXX_STANDARD 17)
  target_compile_options(usearch_c PRIVATE -w)
else()
  message(FATAL_ERROR "usearch submodule missing; run: git submodule update --init --recursive")
endif()

list(APPEND CBERG_SOURCES
  src/search/index.c
  src/search/providers/provider.c
  src/search/providers/common.c
  src/search/providers/registry.c
  src/search/providers/usearch/usearch.c
  src/search/providers/qdrant/qdrant.c
  src/search/providers/qdrant/http_client.c
  src/search/providers/qdrant/json_mini.c
  src/search/providers/pgvector/pgvector.c
)

find_package(CURL)
if(CURL_FOUND)
  set(CBERG_WITH_CURL ON)
  message(STATUS "codeberg: libcurl enabled for qdrant HTTPS (${CURL_LIBRARIES})")
else()
  message(STATUS "codeberg: libcurl not found; qdrant backend supports http:// only")
endif()

find_package(PostgreSQL)
if(PostgreSQL_FOUND)
  set(CBERG_WITH_PGVECTOR ON)
  message(STATUS "codeberg: pgvector backend enabled (${PostgreSQL_LIBRARIES})")
else()
  message(STATUS "codeberg: PostgreSQL/libpq not found; pgvector backend disabled")
endif()

add_library(codeberg_obj OBJECT ${CBERG_SOURCES})
target_include_directories(codeberg_obj
  PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include
  PRIVATE           ${CMAKE_CURRENT_SOURCE_DIR}/src/common
          ${CMAKE_CURRENT_SOURCE_DIR}/src/chunk
          ${CMAKE_CURRENT_SOURCE_DIR}/src/manifest
          ${CMAKE_CURRENT_SOURCE_DIR}/src/watch
          ${CMAKE_CURRENT_SOURCE_DIR}/src/embed
          ${CMAKE_CURRENT_SOURCE_DIR}/src/search
          ${CMAKE_CURRENT_SOURCE_DIR}/third_party
          ${TS_DIR}/lib/include)
target_compile_definitions(codeberg_obj PRIVATE CBERG_VERSION="${CBERG_VERSION}" XXH_STATIC_LINKING_ONLY)
set_target_properties(codeberg_obj PROPERTIES POSITION_INDEPENDENT_CODE ON)
if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(codeberg_obj PRIVATE -Wall -Wextra -Wpedantic)
endif()
if(CBERG_WITH_ONNX)
  target_compile_definitions(codeberg_obj PRIVATE CBERG_WITH_ONNX)
  target_include_directories(codeberg_obj PRIVATE ${ONNXRUNTIME_INCLUDE_DIR} ${OCOS_DIR}/include)
endif()
if(CBERG_WITH_USEARCH)
  target_compile_definitions(codeberg_obj PRIVATE CBERG_WITH_USEARCH)
  target_include_directories(codeberg_obj PRIVATE ${USEARCH_DIR}/c)
endif()
if(CBERG_WITH_CURL)
  target_compile_definitions(codeberg_obj PRIVATE CBERG_WITH_CURL)
  target_link_libraries(codeberg_obj PUBLIC ${CURL_LIBRARIES})
  target_include_directories(codeberg_obj PRIVATE ${CURL_INCLUDE_DIRS})
endif()
if(CBERG_WITH_PGVECTOR)
  target_compile_definitions(codeberg_obj PRIVATE CBERG_WITH_PGVECTOR)
  target_link_libraries(codeberg_obj PUBLIC PostgreSQL::PostgreSQL)
  target_include_directories(codeberg_obj PRIVATE ${PostgreSQL_INCLUDE_DIRS})
endif()

set(CBERG_ALL_OBJECTS
  $<TARGET_OBJECTS:codeberg_obj>
  $<TARGET_OBJECTS:treesitter_runtime>
  ${CBERG_GRAMMAR_OBJECTS})
if(CBERG_WITH_USEARCH)
  list(APPEND CBERG_ALL_OBJECTS $<TARGET_OBJECTS:usearch_c>)
endif()

add_library(codeberg_static STATIC ${CBERG_ALL_OBJECTS})
target_include_directories(codeberg_static PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
set_target_properties(codeberg_static PROPERTIES OUTPUT_NAME codeberg)

add_library(codeberg_shared SHARED ${CBERG_ALL_OBJECTS})
target_include_directories(codeberg_shared PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
set_target_properties(codeberg_shared PROPERTIES OUTPUT_NAME codeberg)

foreach(lib codeberg_static codeberg_shared)
  if(CBERG_WITH_ONNX)
    target_link_libraries(${lib} PUBLIC ${ONNXRUNTIME_LIB}
      ortcustomops ocos_operators noexcep_operators)
  endif()
  if(CBERG_WITH_CURL)
    target_link_libraries(${lib} PUBLIC ${CURL_LIBRARIES})
  endif()
  if(CBERG_WITH_PGVECTOR)
    target_link_libraries(${lib} PUBLIC PostgreSQL::PostgreSQL)
  endif()
  if(APPLE)
    target_link_libraries(${lib} PUBLIC "-framework CoreServices" "-lc++")
  else()
    target_link_libraries(${lib} PUBLIC "-lstdc++")
  endif()
  target_link_libraries(${lib} PUBLIC pthread)
endforeach()

add_library(codeberg::codeberg ALIAS codeberg_static)

enable_testing()

add_subdirectory(cmd/cberg-index)

set(CBERG_PC_LIBS " -lm")
if(CBERG_WITH_ONNX)
  get_filename_component(ONNX_LIBDIR "${ONNXRUNTIME_LIB}" DIRECTORY)
  string(APPEND CBERG_PC_LIBS " -L${ONNX_LIBDIR} -lonnxruntime -Wl,-rpath,${ONNX_LIBDIR}")
  string(APPEND CBERG_PC_LIBS
    " -L$<TARGET_FILE_DIR:ortcustomops> -lortcustomops -locos_operators -lnoexcep_operators")
endif()
if(APPLE)
  string(APPEND CBERG_PC_LIBS " -lc++ -framework CoreServices")
else()
  string(APPEND CBERG_PC_LIBS " -lstdc++")
endif()

configure_file(${CMAKE_CURRENT_SOURCE_DIR}/libcodeberg.pc.in ${CMAKE_CURRENT_BINARY_DIR}/libcodeberg.pc.in.tmp @ONLY)
file(GENERATE OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/libcodeberg.pc
     INPUT ${CMAKE_CURRENT_BINARY_DIR}/libcodeberg.pc.in.tmp)

add_subdirectory(test)
add_subdirectory(bench)
