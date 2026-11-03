package quality
func Save() {} // target:save
func register(callback func()) {} // target:register
func Run() {
  register(Save) // calls:register; references:save
  callback := Save // references:save
  _ = callback
}
