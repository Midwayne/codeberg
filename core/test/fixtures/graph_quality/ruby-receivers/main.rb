class User
  def save
  end
end
class Cache
  def save
  end
end
def run
  user = User.new
  cache = Cache.new
  user.save()
  cache.save()
end
