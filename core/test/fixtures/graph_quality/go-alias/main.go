package quality
import db "example.com/quality/storage"
func Save() {} // target:local
func Run() {
  db.Save() // calls:save
  db.Load() // calls:load
  Save() // calls:local
}
