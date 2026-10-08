add_executable(cberg-index
  main.c
  indexer.c
  ipc.c
)
target_include_directories(cberg-index PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/common
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/chunk)
target_link_libraries(cberg-index PRIVATE codeberg::codeberg)
set_target_properties(cberg-index PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

add_executable(test_cberg_walk test_walk.c)
target_include_directories(test_cberg_walk PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/common)
target_link_libraries(test_cberg_walk PRIVATE codeberg::codeberg)
add_test(NAME test_cberg_walk COMMAND test_cberg_walk)

add_executable(test_cberg_engine test_engine.c indexer.c ipc.c)
target_include_directories(test_cberg_engine PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/common
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/chunk)
target_link_libraries(test_cberg_engine PRIVATE codeberg::codeberg)
add_test(NAME test_cberg_engine COMMAND test_cberg_engine)
set_tests_properties(test_cberg_engine PROPERTIES TIMEOUT 60)

add_executable(test_cberg_hits test_hits.c indexer.c ipc.c)
target_include_directories(test_cberg_hits PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/common
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/chunk)
target_link_libraries(test_cberg_hits PRIVATE codeberg::codeberg)
add_test(NAME test_cberg_hits COMMAND test_cberg_hits)
set_tests_properties(test_cberg_hits PROPERTIES TIMEOUT 60)

add_executable(test_cberg_vectors test_vectors.c indexer.c ipc.c)
target_include_directories(test_cberg_vectors PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/common
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/chunk)
target_link_libraries(test_cberg_vectors PRIVATE codeberg::codeberg)
target_compile_definitions(test_cberg_vectors PRIVATE
  CBERG_LOG_WORKER="${CMAKE_CURRENT_SOURCE_DIR}/embed_log_worker.py")
add_test(NAME test_cberg_vectors COMMAND test_cberg_vectors)
set_tests_properties(test_cberg_vectors PROPERTIES TIMEOUT 60)
