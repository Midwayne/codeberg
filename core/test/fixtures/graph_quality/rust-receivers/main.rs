struct User;
struct Cache;
impl User {
  fn save(&self) {}
}
impl Cache {
  fn save(&self) {}
}
fn run(user: &User, cache: &Cache) {
  user.save();
  cache.save();
}
