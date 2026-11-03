static void save(void) {}
void shadow(void (*save)(void)) {
  save();
}
void direct(void) {
  save();
}
