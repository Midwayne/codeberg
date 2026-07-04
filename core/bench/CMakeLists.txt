function(cberg_add_bench name)
  add_executable(${name} ${name}.c)
  target_link_libraries(${name} PRIVATE codeberg::codeberg)
  target_include_directories(${name} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/common
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/chunk)
endfunction()

cberg_add_bench(bench_strmap)
cberg_add_bench(bench_u64map)
cberg_add_bench(bench_chunk_table)
