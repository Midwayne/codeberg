class User {
  void save() {}
}
class Cache {
  void save() {}
}
class Main {
  void run(User user, Cache cache) {
    user.save();
    cache.save();
  }
}
