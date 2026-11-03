package quality
type User struct{}
type Cache struct{}
func (u *User) Save() {} // target:user_save
func (c *Cache) Save() {} // target:cache_save
func (u *User) Run() {
  u.Save() // calls:user_save
}
func Work(u *User, c *Cache) {
  u.Save() // calls:user_save
  c.Save() // calls:cache_save
}
