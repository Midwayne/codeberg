def outer(save):
    def inner():
        def save():
            pass
        save()
    inner()
