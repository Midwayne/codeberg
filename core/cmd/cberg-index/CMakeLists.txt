add_executable(cberg-index
  main.c
  indexer.c
  walk.c
  ipc.c
)
target_include_directories(cberg-index PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/common)
target_link_libraries(cberg-index PRIVATE codeberg::codeberg)
set_target_properties(cberg-index PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

add_executable(test_cberg_walk test_walk.c walk.c)
target_include_directories(test_cberg_walk PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(test_cberg_walk PRIVATE codeberg::codeberg)
add_test(NAME test_cberg_walk COMMAND test_cberg_walk)

add_executable(test_cberg_engine test_engine.c indexer.c walk.c ipc.c)
target_include_directories(test_cberg_engine PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../src/common)
target_link_libraries(test_cberg_engine PRIVATE codeberg::codeberg)
add_test(NAME test_cberg_engine COMMAND test_cberg_engine)
set_tests_properties(test_cberg_engine PROPERTIES TIMEOUT 60)
