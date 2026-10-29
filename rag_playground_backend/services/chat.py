from db_handler.conversation_handler import ConversationHandler
from utils import logger

class ConversationService():
    def __init__(self) -> None:
        pass

    async def get_conversation(self, reference_uuid):
        try:
            conversation_handler = ConversationHandler()
            conversations = await conversation_handler.get_conversation(reference_uuid=reference_uuid)
            return [{"id": item.id, "user": item.user, "agent": item.agent or ""} for item in conversations]
        except Exception:
            logger.exception("Error in fetching conversation")
            raise