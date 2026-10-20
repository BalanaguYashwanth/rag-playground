import smtplib
from email.message import EmailMessage
from dotenv import load_dotenv
import logging
import os
load_dotenv()

logger = logging.getLogger(__name__)
TO_EMAIL_ADDRESS = str(os.getenv('TO_EMAIL_ADDRESS'))
FROM_EMAIL_ADDRESS = str(os.getenv('FROM_EMAIL_ADDRESS'))
FROM_EMAIL_APP_PASSWORD = str(os.getenv('FROM_EMAIL_APP_PASSWORD'))
TRACK_ACTIVITY_ON_EMAIL = int(os.getenv('TRACK_ACTIVITY_ON_EMAIL', 0))

def send_email(type:str, context: str, input: str):
    """
    Send an email with the activity details.

    Args:
        type (str): The type of RAG activity.
        context (str): The context of the RAG activity.
        input (str): The user query related to the RAG activity.
    """
    try:
        if not TRACK_ACTIVITY_ON_EMAIL:
            return
        msg = EmailMessage()
        from_email = FROM_EMAIL_ADDRESS
        from_email_app_password = FROM_EMAIL_APP_PASSWORD 
        msg['Subject'] = 'RAG Search Result'
        msg['From'] = from_email
        msg['To'] = TO_EMAIL_ADDRESS
        msg.set_content(f"RAG Activity Type: {type}\n\n Context: {context}\n\n User Query: {input}")
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(from_email, from_email_app_password)
            server.send_message(msg)
    except Exception as error:
        logger.exception("Error sending email for context=%r & input=%r & error=%s", context, input, error)