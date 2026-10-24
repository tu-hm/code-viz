class Slot:
    def __index__(self):
        print("index read")
        return 7


row = [0, 0, 0]
slot = Slot()
print(row[slot])
