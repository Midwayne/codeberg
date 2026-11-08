# Everything cberg-index runs except main(): shared by the binary and the
# engine tests. The include directories are the library-internal headers the
# engine is allowed to use; keep them in this one place.
add_library(cberg_index_engine STATIC
  indexer.c
  embedding.c
  ipc.c
  wipe.c
  workspace_graph.c
  workspace_resolve.c
)
target_include_directories(cberg_index_engine PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/common
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/chunk
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/embed
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/graph)
target_link_libraries(cberg_index_engine PUBLIC codeberg::codeberg)
if(CBERG_WITH_ONNX)
  target_compile_definitions(cberg_index_engine PUBLIC CBERG_WITH_ONNX)
endif()

add_executable(cberg-index main.c)
target_link_libraries(cberg-index PRIVATE cberg_index_engine)
set_target_properties(cberg-index PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

add_test(NAME test_cberg_capabilities COMMAND cberg-index --capabilities)
set_tests_properties(test_cberg_capabilities PROPERTIES
  ENVIRONMENT "CBERG_MODEL=missing-model;CODEBERG_ROOTS=invalid-roots")
if(CBERG_WITH_ONNX)
  set_tests_properties(test_cberg_capabilities PROPERTIES PASS_REGULAR_EXPRESSION "\"onnx\":true")
else()
  set_tests_properties(test_cberg_capabilities PROPERTIES PASS_REGULAR_EXPRESSION "\"onnx\":false")
endif()

function(cberg_engine_test name source)
  add_executable(${name} ${source})
  target_link_libraries(${name} PRIVATE cberg_index_engine)
  add_test(NAME ${name} COMMAND ${name})
  set_tests_properties(${name} PROPERTIES TIMEOUT 60)
endfunction()

cberg_engine_test(test_cberg_walk test_walk.c)
cberg_engine_test(test_cberg_engine test_engine.c)
cberg_engine_test(test_workspace_graph test_workspace_graph.c)
cberg_engine_test(test_cberg_hits test_hits.c)
cberg_engine_test(test_cberg_wipe test_wipe.c)

cberg_engine_test(test_cberg_vectors test_vectors.c)
target_compile_definitions(test_cberg_vectors PRIVATE
  CBERG_LOG_WORKER="${CMAKE_CURRENT_SOURCE_DIR}/embed_log_worker.py")
add_test(NAME test_cberg_vectors_gemma COMMAND test_cberg_vectors sentence-transformers)
set_tests_properties(test_cberg_vectors_gemma PROPERTIES TIMEOUT 60)
add_test(NAME test_cberg_vectors_gemma_mlx COMMAND test_cberg_vectors gemma-mlx)
set_tests_properties(test_cberg_vectors_gemma_mlx PROPERTIES TIMEOUT 60)
