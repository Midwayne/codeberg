add_executable(cberg-index
  main.c
  wipe.c
  indexer.c
  embedding.c
  ipc.c
)
target_include_directories(cberg-index PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/common
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/chunk)
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

add_executable(test_cberg_walk test_walk.c)
target_include_directories(test_cberg_walk PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/common)
target_link_libraries(test_cberg_walk PRIVATE codeberg::codeberg)
add_test(NAME test_cberg_walk COMMAND test_cberg_walk)

add_executable(test_cberg_engine test_engine.c indexer.c embedding.c ipc.c)
target_include_directories(test_cberg_engine PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/common
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/chunk)
target_link_libraries(test_cberg_engine PRIVATE codeberg::codeberg)
add_test(NAME test_cberg_engine COMMAND test_cberg_engine)
set_tests_properties(test_cberg_engine PROPERTIES TIMEOUT 60)

add_executable(test_workspace_graph test_workspace_graph.c indexer.c embedding.c ipc.c)
target_include_directories(test_workspace_graph PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/common
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/chunk
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/embed)
target_link_libraries(test_workspace_graph PRIVATE codeberg::codeberg)
add_test(NAME test_workspace_graph COMMAND test_workspace_graph)
set_tests_properties(test_workspace_graph PROPERTIES TIMEOUT 60)

add_executable(test_cberg_hits test_hits.c indexer.c embedding.c ipc.c)
target_include_directories(test_cberg_hits PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/common
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/chunk)
target_link_libraries(test_cberg_hits PRIVATE codeberg::codeberg)
add_test(NAME test_cberg_hits COMMAND test_cberg_hits)
set_tests_properties(test_cberg_hits PROPERTIES TIMEOUT 60)

add_executable(test_cberg_vectors test_vectors.c indexer.c embedding.c ipc.c)
target_include_directories(test_cberg_vectors PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/common
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/chunk)
target_link_libraries(test_cberg_vectors PRIVATE codeberg::codeberg)
target_compile_definitions(test_cberg_vectors PRIVATE
  CBERG_LOG_WORKER="${CMAKE_CURRENT_SOURCE_DIR}/embed_log_worker.py")
add_test(NAME test_cberg_vectors COMMAND test_cberg_vectors)
set_tests_properties(test_cberg_vectors PROPERTIES TIMEOUT 60)
add_test(NAME test_cberg_vectors_gemma COMMAND test_cberg_vectors sentence-transformers)
set_tests_properties(test_cberg_vectors_gemma PROPERTIES TIMEOUT 60)
add_test(NAME test_cberg_vectors_gemma_mlx COMMAND test_cberg_vectors gemma-mlx)
set_tests_properties(test_cberg_vectors_gemma_mlx PROPERTIES TIMEOUT 60)

add_executable(test_cberg_wipe test_wipe.c wipe.c)
target_link_libraries(test_cberg_wipe PRIVATE codeberg::codeberg)
add_test(NAME test_cberg_wipe COMMAND test_cberg_wipe)

foreach(target cberg-index test_cberg_engine test_cberg_hits test_cberg_vectors)
  target_include_directories(${target} PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../../src/embed)
endforeach()

foreach(target cberg-index test_cberg_engine test_cberg_hits test_cberg_vectors test_workspace_graph)
  target_sources(${target} PRIVATE workspace_graph.c workspace_resolve.c)
endforeach()
