from database import engine

try:
    with engine.connect() as connection:
        print("Database connected!")
except Exception as e:
    print(e)