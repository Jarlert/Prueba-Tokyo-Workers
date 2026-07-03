import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

load_dotenv()

# La URL de Railway normalmente tiene el formato: 
# postgresql://usuario:contraseña@host:puerto/nombre_bd
DATABASE_URL = os.getenv("DATABASE_URL")

# create_engine maneja el pool de conexiones automáticamente
engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Dependencia para inyectar la sesión en los endpoints de FastAPI
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()