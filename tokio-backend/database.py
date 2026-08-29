import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

load_dotenv()

# La URL de Railway normalmente tiene el formato: 
# postgresql://usuario:contraseña@host:puerto/nombre_bd
DATABASE_URL = os.getenv("DATABASE_URL")

# pool_pre_ping: Railway cierra las conexiones que llevan rato ociosas. Sin esta
# comprobación, la primera petición después de un periodo sin tráfico falla con
# OperationalError aunque la base esté perfectamente viva.
#
# El pool va dimensionado a la baja a propósito: corre un solo worker de uvicorn,
# y los valores por defecto de SQLAlchemy (5 + 10 de overflow) permiten hasta 15
# conexiones simultáneas que Postgres reserva en RAM. La RAM es el 96% de lo que
# cuesta este proyecto en Railway, así que conexiones que nunca se usan son
# dinero tirado.
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=3,
    max_overflow=2,
    pool_recycle=1800,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Dependencia para inyectar la sesión en los endpoints de FastAPI
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()