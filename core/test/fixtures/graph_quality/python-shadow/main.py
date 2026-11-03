def save():
    pass
def shadow(save):
    save()
def outer():
    def save():
        pass
    save()
