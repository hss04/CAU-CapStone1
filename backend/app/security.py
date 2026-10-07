from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import User


password_hasher = PasswordHash.recommended()
DUMMY_HASH = password_hasher.hash('timing-only-unused-password')
oauth2 = OAuth2PasswordBearer(tokenUrl='/api/v1/auth/token')
Db = Annotated[Session, Depends(get_db)]


def unauthorized():
    return HTTPException(401, 'Invalid email, password or access token', headers={'WWW-Authenticate':'Bearer'})


def create_token(user: User):
    settings = get_settings()
    now = datetime.now(timezone.utc)
    return {'access_token':jwt.encode({'sub':str(user.id),'iat':now,
            'exp':now+timedelta(minutes=settings.access_token_expire_minutes),
            'iss':'plantlight-api','aud':'plantlight-client'},settings.jwt_secret,algorithm='HS256'),
            'token_type':'bearer','expires_in':settings.access_token_expire_minutes*60}


def current_user(db: Db, token: Annotated[str, Depends(oauth2)]) -> User:
    try:
        claims = jwt.decode(token,get_settings().jwt_secret,algorithms=['HS256'],
                            issuer='plantlight-api',audience='plantlight-client',
                            options={'require':['sub','exp','iat','iss','aud']})
        subject = claims['sub']
        if not isinstance(subject,str) or not subject.isdecimal() or len(subject)>18:
            raise unauthorized()
        user = db.get(User,int(subject))
        if user is None:
            raise unauthorized()
        return user
    except InvalidTokenError as exc:
        raise unauthorized() from exc


CurrentUser = Annotated[User, Depends(current_user)]
