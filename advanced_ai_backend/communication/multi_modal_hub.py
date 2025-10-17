import os
import json
import logging
import smtplib
import imaplib
import email
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from enum import Enum
import requests
import re
from openai import OpenAI

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class MessageType(Enum):
    SMS = "sms"
    EMAIL = "email"
    WHATSAPP = "whatsapp"
    PHONE = "phone"

class MessageDirection(Enum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"

class MessageStatus(Enum):
    PENDING = "pending"
    SENT = "sent"
    DELIVERED = "delivered"
    READ = "read"
    FAILED = "failed"

@dataclass
class Message:
    id: Optional[str]
    type: MessageType
    direction: MessageDirection
    sender: str
    recipient: str
    content: str
    subject: Optional[str] = None
    attachments: List[str] = None
    status: MessageStatus = MessageStatus.PENDING
    timestamp: datetime = None
    metadata: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.now()
        if self.attachments is None:
            self.attachments = []
        if self.metadata is None:
            self.metadata = {}

class MultiModalCommunicationHub:
    """
    Advanced communication hub that handles SMS, Email, and WhatsApp
    with AI-powered message processing and automated responses
    """
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.ai_client = OpenAI()
        self.message_queue = []
        self.conversation_history = {}
        
        # Initialize communication channels
        self._setup_email_client()
        self._setup_sms_client()
        self._setup_whatsapp_client()
        
    def _setup_email_client(self):
        """Setup email client configuration"""
        self.email_config = {
            'smtp_server': self.config.get('email', {}).get('smtp_server', 'smtp.gmail.com'),
            'smtp_port': self.config.get('email', {}).get('smtp_port', 587),
            'imap_server': self.config.get('email', {}).get('imap_server', 'imap.gmail.com'),
            'imap_port': self.config.get('email', {}).get('imap_port', 993),
            'username': self.config.get('email', {}).get('username', 'noodzakelijkonline@gmail.com'),
            'password': self.config.get('email', {}).get('password', 'your_app_password'),
            'from_name': self.config.get('email', {}).get('from_name', 'Contractor AI Assistant')
        }
        
    def _setup_sms_client(self):
        """Setup SMS client configuration"""
        self.sms_config = {
            'provider': self.config.get('sms', {}).get('provider', 'twilio'),
            'api_key': self.config.get('sms', {}).get('api_key', ''),
            'api_secret': self.config.get('sms', {}).get('api_secret', ''),
            'from_number': self.config.get('sms', {}).get('from_number', '+31 06-83515175')
        }
        
    def _setup_whatsapp_client(self):
        """Setup WhatsApp client configuration"""
        self.whatsapp_config = {
            'api_url': self.config.get('whatsapp', {}).get('api_url', ''),
            'api_token': self.config.get('whatsapp', {}).get('api_token', ''),
            'webhook_url': self.config.get('whatsapp', {}).get('webhook_url', ''),
            'phone_number': self.config.get('whatsapp', {}).get('phone_number', '+31683515175')
        }
    
    # Email Communication Methods
    def send_email(self, to_email: str, subject: str, content: str, html_content: str = None) -> Message:
        """Send email with both text and HTML content"""
        try:
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = f"{self.email_config['from_name']} <{self.email_config['username']}>"
            msg['To'] = to_email
            
            # Add text content
            text_part = MIMEText(content, 'plain')
            msg.attach(text_part)
            
            # Add HTML content if provided
            if html_content:
                html_part = MIMEText(html_content, 'html')
                msg.attach(html_part)
            
            # Send email
            with smtplib.SMTP(self.email_config['smtp_server'], self.email_config['smtp_port']) as server:
                server.starttls()
                server.login(self.email_config['username'], self.email_config['password'])
                server.send_message(msg)
            
            # Create message record
            message = Message(
                id=f"email_{datetime.now().timestamp()}",
                type=MessageType.EMAIL,
                direction=MessageDirection.OUTBOUND,
                sender=self.email_config['username'],
                recipient=to_email,
                content=content,
                subject=subject,
                status=MessageStatus.SENT,
                metadata={'html_content': html_content}
            )
            
            self._store_message(message)
            logger.info(f"Email sent to {to_email}: {subject}")
            
            return message
            
        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {e}")
            return Message(
                id=None,
                type=MessageType.EMAIL,
                direction=MessageDirection.OUTBOUND,
                sender=self.email_config['username'],
                recipient=to_email,
                content=content,
                subject=subject,
                status=MessageStatus.FAILED,
                metadata={'error': str(e)}
            )
    
    def check_emails(self) -> List[Message]:
        """Check for new emails and process them"""
        try:
            messages = []
            
            with imaplib.IMAP4_SSL(self.email_config['imap_server'], self.email_config['imap_port']) as mail:
                mail.login(self.email_config['username'], self.email_config['password'])
                mail.select('INBOX')
                
                # Search for unread emails
                _, message_numbers = mail.search(None, 'UNSEEN')
                
                for num in message_numbers[0].split():
                    _, msg_data = mail.fetch(num, '(RFC822)')
                    email_body = msg_data[0][1]
                    email_message = email.message_from_bytes(email_body)
                    
                    # Extract email content
                    content = self._extract_email_content(email_message)
                    
                    message = Message(
                        id=f"email_in_{num.decode()}",
                        type=MessageType.EMAIL,
                        direction=MessageDirection.INBOUND,
                        sender=email_message['From'],
                        recipient=self.email_config['username'],
                        content=content,
                        subject=email_message['Subject'],
                        status=MessageStatus.READ
                    )
                    
                    messages.append(message)
                    self._store_message(message)
                    
                    # Process with AI
                    self._process_inbound_message(message)
            
            return messages
            
        except Exception as e:
            logger.error(f"Failed to check emails: {e}")
            return []
    
    # SMS Communication Methods
    def send_sms(self, to_number: str, content: str) -> Message:
        """Send SMS message"""
        try:
            # Simulate SMS sending (replace with actual SMS provider API)
            logger.info(f"SMS would be sent to {to_number}: {content}")
            
            message = Message(
                id=f"sms_{datetime.now().timestamp()}",
                type=MessageType.SMS,
                direction=MessageDirection.OUTBOUND,
                sender=self.sms_config['from_number'],
                recipient=to_number,
                content=content,
                status=MessageStatus.SENT
            )
            
            self._store_message(message)
            return message
            
        except Exception as e:
            logger.error(f"Failed to send SMS to {to_number}: {e}")
            return Message(
                id=None,
                type=MessageType.SMS,
                direction=MessageDirection.OUTBOUND,
                sender=self.sms_config['from_number'],
                recipient=to_number,
                content=content,
                status=MessageStatus.FAILED,
                metadata={'error': str(e)}
            )
    
    # WhatsApp Communication Methods
    def send_whatsapp(self, to_number: str, content: str, media_url: str = None) -> Message:
        """Send WhatsApp message"""
        try:
            # Simulate WhatsApp sending (replace with actual WhatsApp Business API)
            logger.info(f"WhatsApp would be sent to {to_number}: {content}")
            
            message = Message(
                id=f"whatsapp_{datetime.now().timestamp()}",
                type=MessageType.WHATSAPP,
                direction=MessageDirection.OUTBOUND,
                sender=self.whatsapp_config['phone_number'],
                recipient=to_number,
                content=content,
                status=MessageStatus.SENT,
                metadata={'media_url': media_url} if media_url else {}
            )
            
            self._store_message(message)
            return message
            
        except Exception as e:
            logger.error(f"Failed to send WhatsApp to {to_number}: {e}")
            return Message(
                id=None,
                type=MessageType.WHATSAPP,
                direction=MessageDirection.OUTBOUND,
                sender=self.whatsapp_config['phone_number'],
                recipient=to_number,
                content=content,
                status=MessageStatus.FAILED,
                metadata={'error': str(e)}
            )
    
    def process_whatsapp_webhook(self, webhook_data: Dict[str, Any]) -> List[Message]:
        """Process incoming WhatsApp webhook data"""
        try:
            messages = []
            
            # Parse webhook data (format depends on WhatsApp provider)
            for entry in webhook_data.get('entry', []):
                for change in entry.get('changes', []):
                    if change.get('field') == 'messages':
                        for msg in change.get('value', {}).get('messages', []):
                            message = Message(
                                id=msg.get('id'),
                                type=MessageType.WHATSAPP,
                                direction=MessageDirection.INBOUND,
                                sender=msg.get('from'),
                                recipient=self.whatsapp_config['phone_number'],
                                content=msg.get('text', {}).get('body', ''),
                                status=MessageStatus.READ,
                                metadata=msg
                            )
                            
                            messages.append(message)
                            self._store_message(message)
                            
                            # Process with AI
                            self._process_inbound_message(message)
            
            return messages
            
        except Exception as e:
            logger.error(f"Failed to process WhatsApp webhook: {e}")
            return []
    
    # AI-Powered Message Processing
    def _process_inbound_message(self, message: Message):
        """Process inbound message with AI and generate appropriate response"""
        try:
            # Analyze message intent
            intent_analysis = self._analyze_message_intent(message)
            
            # Generate appropriate response
            if intent_analysis['requires_response']:
                response_content = self._generate_ai_response(message, intent_analysis)
                
                # Send response via same channel
                if message.type == MessageType.EMAIL:
                    self.send_email(
                        to_email=message.sender,
                        subject=f"Re: {message.subject}",
                        content=response_content
                    )
                elif message.type == MessageType.SMS:
                    self.send_sms(message.sender, response_content)
                elif message.type == MessageType.WHATSAPP:
                    self.send_whatsapp(message.sender, response_content)
            
            # Extract job information if applicable
            if intent_analysis['contains_job_request']:
                self._extract_job_information(message, intent_analysis)
                
        except Exception as e:
            logger.error(f"Failed to process inbound message: {e}")
    
    def _analyze_message_intent(self, message: Message) -> Dict[str, Any]:
        """Analyze message intent using AI"""
        try:
            prompt = f"""
            Analyze this message and determine the intent:
            
            Message Type: {message.type.value}
            From: {message.sender}
            Content: {message.content}
            Subject: {message.subject or 'N/A'}
            
            Determine:
            1. Intent category (job_request, question, complaint, emergency, update, etc.)
            2. Urgency level (low, medium, high, critical)
            3. Whether it requires immediate response
            4. Whether it contains a job request
            5. Key information extracted
            6. Sentiment (positive, neutral, negative)
            
            Return as JSON with these fields.
            """
            
            response = self.ai_client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {"role": "system", "content": "You are an AI assistant analyzing customer communications for a contractor business."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3
            )
            
            return json.loads(response.choices[0].message.content)
            
        except Exception as e:
            logger.error(f"Failed to analyze message intent: {e}")
            return {
                'intent_category': 'unknown',
                'urgency_level': 'medium',
                'requires_response': True,
                'contains_job_request': False,
                'sentiment': 'neutral'
            }
    
    def _generate_ai_response(self, message: Message, intent_analysis: Dict[str, Any]) -> str:
        """Generate appropriate AI response based on message and intent"""
        try:
            # Get conversation history
            history = self._get_conversation_history(message.sender)
            
            prompt = f"""
            Generate a professional response to this customer message:
            
            Original Message: {message.content}
            Intent: {intent_analysis.get('intent_category', 'unknown')}
            Urgency: {intent_analysis.get('urgency_level', 'medium')}
            Sentiment: {intent_analysis.get('sentiment', 'neutral')}
            
            Context:
            - You are an AI assistant for a professional contractor business
            - Be helpful, professional, and friendly
            - If it's a job request, ask clarifying questions
            - If it's urgent, acknowledge the urgency
            - Keep responses concise but informative
            - Include next steps when appropriate
            
            Response:
            """
            
            response = self.ai_client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {"role": "system", "content": "You are a professional contractor's AI assistant. Generate helpful, clear responses."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=200
            )
            
            return response.choices[0].message.content.strip()
            
        except Exception as e:
            logger.error(f"Failed to generate AI response: {e}")
            return "Thank you for your message. We'll get back to you shortly with more information."
    
    def _extract_job_information(self, message: Message, intent_analysis: Dict[str, Any]):
        """Extract job information from message and create job request"""
        try:
            prompt = f"""
            Extract job information from this message:
            
            Message: {message.content}
            
            Extract:
            1. Job type (plumbing, electrical, cleaning, renovation, etc.)
            2. Location/address
            3. Urgency/timeline
            4. Description of work needed
            5. Budget mentioned (if any)
            6. Preferred contact method
            7. Any special requirements
            
            Return as JSON with these fields.
            """
            
            response = self.ai_client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {"role": "system", "content": "You are an AI assistant extracting job information from customer messages."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3
            )
            
            job_info = json.loads(response.choices[0].message.content)
            
            # Store job request for processing
            self._create_job_request(message, job_info)
            
        except Exception as e:
            logger.error(f"Failed to extract job information: {e}")
    
    def _create_job_request(self, message: Message, job_info: Dict[str, Any]):
        """Create a job request from extracted information"""
        try:
            job_request = {
                'source_message_id': message.id,
                'client_contact': message.sender,
                'communication_type': message.type.value,
                'job_info': job_info,
                'created_at': datetime.now(),
                'status': 'pending_review'
            }
            
            # This would integrate with the job management system
            logger.info(f"Job request created from {message.type.value} message: {job_info.get('job_type', 'unknown')}")
            
            # Notify contractor about new job request
            self._notify_contractor_new_job(job_request)
            
        except Exception as e:
            logger.error(f"Failed to create job request: {e}")
    
    def _notify_contractor_new_job(self, job_request: Dict[str, Any]):
        """Notify contractor about new job request"""
        try:
            notification_content = f"""
            New Job Request Received!
            
            Type: {job_request['job_info'].get('job_type', 'Unknown')}
            From: {job_request['client_contact']}
            Via: {job_request['communication_type'].upper()}
            
            Description: {job_request['job_info'].get('description', 'No description provided')}
            Location: {job_request['job_info'].get('location', 'Not specified')}
            Timeline: {job_request['job_info'].get('timeline', 'Not specified')}
            
            Please review and respond via the dashboard.
            """
            
            # Send notification to contractor
            self.send_email(
                to_email='noodzakelijkonline@gmail.com',
                subject='New Job Request - Action Required',
                content=notification_content
            )
            
            self.send_sms(
                to_number='+31683515175',
                content=f"New {job_request['job_info'].get('job_type', 'job')} request received. Check dashboard for details."
            )
            
        except Exception as e:
            logger.error(f"Failed to notify contractor: {e}")
    
    # Utility Methods
    def _extract_email_content(self, email_message) -> str:
        """Extract text content from email message"""
        try:
            if email_message.is_multipart():
                for part in email_message.walk():
                    if part.get_content_type() == "text/plain":
                        return part.get_payload(decode=True).decode()
            else:
                return email_message.get_payload(decode=True).decode()
        except Exception as e:
            logger.error(f"Failed to extract email content: {e}")
            return "Could not extract email content"
    
    def _store_message(self, message: Message):
        """Store message in conversation history"""
        try:
            contact = message.sender if message.direction == MessageDirection.INBOUND else message.recipient
            
            if contact not in self.conversation_history:
                self.conversation_history[contact] = []
            
            self.conversation_history[contact].append(message)
            
            # Keep only recent messages (last 50 per contact)
            if len(self.conversation_history[contact]) > 50:
                self.conversation_history[contact] = self.conversation_history[contact][-50:]
                
        except Exception as e:
            logger.error(f"Failed to store message: {e}")
    
    def _get_conversation_history(self, contact: str) -> List[Message]:
        """Get conversation history for a contact"""
        return self.conversation_history.get(contact, [])
    
    def get_recent_messages(self, limit: int = 20) -> List[Message]:
        """Get recent messages across all channels"""
        all_messages = []
        
        for contact, messages in self.conversation_history.items():
            all_messages.extend(messages)
        
        # Sort by timestamp and return recent messages
        all_messages.sort(key=lambda x: x.timestamp, reverse=True)
        return all_messages[:limit]
    
    def get_conversation_with_contact(self, contact: str) -> List[Message]:
        """Get full conversation history with a specific contact"""
        return self._get_conversation_history(contact)
    
    def send_bulk_message(self, contacts: List[str], content: str, message_type: MessageType = MessageType.WHATSAPP) -> List[Message]:
        """Send bulk messages to multiple contacts"""
        messages = []
        
        for contact in contacts:
            try:
                if message_type == MessageType.EMAIL:
                    message = self.send_email(contact, "Update from Contractor AI", content)
                elif message_type == MessageType.SMS:
                    message = self.send_sms(contact, content)
                elif message_type == MessageType.WHATSAPP:
                    message = self.send_whatsapp(contact, content)
                
                messages.append(message)
                
            except Exception as e:
                logger.error(f"Failed to send bulk message to {contact}: {e}")
        
        return messages
    
    def process_all_channels(self):
        """Process all communication channels for new messages"""
        try:
            # Check emails
            new_emails = self.check_emails()
            logger.info(f"Processed {len(new_emails)} new emails")
            
            # In a real implementation, you would also:
            # - Check SMS webhook/API for new messages
            # - Process WhatsApp webhook data
            # - Handle any queued outbound messages
            
        except Exception as e:
            logger.error(f"Failed to process all channels: {e}")

# Configuration example
def get_default_config():
    """Get default configuration for the communication hub"""
    return {
        'email': {
            'smtp_server': 'smtp.gmail.com',
            'smtp_port': 587,
            'imap_server': 'imap.gmail.com',
            'imap_port': 993,
            'username': 'noodzakelijkonline@gmail.com',
            'password': 'your_app_password',  # Use app-specific password
            'from_name': 'Contractor AI Assistant'
        },
        'sms': {
            'provider': 'twilio',
            'api_key': 'your_twilio_api_key',
            'api_secret': 'your_twilio_api_secret',
            'from_number': '+31683515175'
        },
        'whatsapp': {
            'api_url': 'https://api.whatsapp.business',
            'api_token': 'your_whatsapp_token',
            'webhook_url': 'https://your-domain.com/whatsapp-webhook',
            'phone_number': '+31683515175'
        }
    }

