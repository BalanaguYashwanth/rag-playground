from sqlalchemy import select
from db_handler.db import AsyncSessionLocal
from db_models.conversation import ConversationModel

class ConversationHandler:

    async def update_conversation(self, user, agent, reference_uuid):
        try:
            async with AsyncSessionLocal() as session:
                conversation = ConversationModel(user=user, agent=agent, reference_uuid=reference_uuid, )
                session.add(conversation)
                await session.commit()
        except Exception as error:
            await session.rollback()
            raise


    async def get_conversation(self, reference_uuid):
        async with AsyncSessionLocal() as session:
            conversation = await session.execute(
                select(ConversationModel).where(
                    ConversationModel.reference_uuid == reference_uuid,
                )
            )
            return conversation.scalars().all()

    