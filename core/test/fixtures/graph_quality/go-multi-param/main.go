package quality
type User struct{}
func (u *User) Save() {}
func Work(first, second *User) {
  first.Save()
  second.Save()
}
