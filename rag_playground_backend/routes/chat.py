from typing import Annotated
from fastapi import APIRouter, HTTPException, Path
from constant import USER_ID_PATTERN
from services.chat import ConversationService

chat_router = APIRouter(prefix='/chat', tags=['chat'])

@chat_router.get("/{user_id}")
async def conversation(user_id: Annotated[str, Path(pattern=USER_ID_PATTERN)]):
    try:
        conversation_service = ConversationService()
        return await conversation_service.get_conversation(user_id)
    except Exception:
        raise HTTPException(500, "Couldn't fetch the conversation")