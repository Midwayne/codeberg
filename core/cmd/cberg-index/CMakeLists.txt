add_executable(cberg-index
  main.c
  indexer.c
  walk.c
  ipc.c
)
target_include_directories(cberg-index PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(cberg-index PRIVATE codeberg::codeberg)
set_target_properties(cberg-index PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
