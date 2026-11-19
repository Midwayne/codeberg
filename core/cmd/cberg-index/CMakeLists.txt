set(CBERG_INDEX_INCLUDE_DIRS
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/common
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/chunk
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/embed
)

# Everything the indexer binary and its integration tests share.
set(CBERG_INDEX_ENGINE_SOURCES
  engine.c
  bootstrap.c
  watch_loop.c
  repo_sync.c
  repo_vectors.c
  repo_state.c
  nested_roots.c
  chunk_batch.c
  query_chunks.c
  query_graph.c
  embedding.c
  ipc.c
  ipc_wire.c
  ipc_chunk_commands.c
  ipc_graph_commands.c
  workspace_graph.c
  workspace_resolve.c
)

add_executable(cberg-index
  main.c
  wipe.c
  ${CBERG_INDEX_ENGINE_SOURCES}
)
target_include_directories(cberg-index PRIVATE ${CBERG_INDEX_INCLUDE_DIRS})
target_link_libraries(cberg-index PRIVATE codeberg::codeberg)
set_target_properties(cberg-index PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

add_test(NAME test_cberg_capabilities COMMAND cberg-index --capabilities)
set_tests_properties(test_cberg_capabilities PROPERTIES
  ENVIRONMENT "CBERG_MODEL=missing-model;CBERG_ROOTS=invalid-roots")
if(CBERG_WITH_ONNX)
  target_compile_definitions(cberg-index PRIVATE CBERG_WITH_ONNX)
  set_tests_properties(test_cberg_capabilities PROPERTIES PASS_REGULAR_EXPRESSION "\"onnx\":true")
else()
  set_tests_properties(test_cberg_capabilities PROPERTIES PASS_REGULAR_EXPRESSION "\"onnx\":false")
endif()

# cberg_index_test(<name> <source> [<extra source>...])
# Builds test/<source> into a test binary named <name> and registers it.
function(cberg_index_test name source)
  add_executable(${name} test/${source} ${ARGN})
  target_include_directories(${name} PRIVATE ${CBERG_INDEX_INCLUDE_DIRS})
  target_link_libraries(${name} PRIVATE codeberg::codeberg)
  add_test(NAME ${name} COMMAND ${name})
endfunction()

# Tests that run the whole engine in-process.
function(cberg_index_engine_test name source)
  cberg_index_test(${name} ${source} ${CBERG_INDEX_ENGINE_SOURCES})
  set_tests_properties(${name} PROPERTIES TIMEOUT 60)
endfunction()

cberg_index_test(test_cberg_walk test_walk.c)
cberg_index_test(test_cberg_wipe test_wipe.c wipe.c)

cberg_index_engine_test(test_cberg_engine test_engine.c)
cberg_index_engine_test(test_cberg_bootstrap test_bootstrap.c)
cberg_index_engine_test(test_workspace_graph test_workspace_graph.c)
cberg_index_engine_test(test_cberg_graph_queries test_graph_queries.c)
cberg_index_engine_test(test_cberg_hits test_hits.c)
cberg_index_engine_test(test_cberg_nested_roots test_nested_roots.c)
cberg_index_engine_test(test_cberg_vectors test_vectors.c)

# test_cberg_vectors drives a scripted embedding worker; its argument picks the
# worker protocol variant.
target_compile_definitions(test_cberg_vectors PRIVATE
  CBERG_LOG_WORKER="${CMAKE_CURRENT_SOURCE_DIR}/test/embed_log_worker.py")
add_test(NAME test_cberg_vectors_gemma COMMAND test_cberg_vectors sentence-transformers)
set_tests_properties(test_cberg_vectors_gemma PROPERTIES TIMEOUT 60)
add_test(NAME test_cberg_vectors_gemma_mlx COMMAND test_cberg_vectors gemma-mlx)
set_tests_properties(test_cberg_vectors_gemma_mlx PROPERTIES TIMEOUT 60)
