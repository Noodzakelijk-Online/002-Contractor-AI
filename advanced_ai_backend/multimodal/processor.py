import os
import json
import logging
import tempfile
import mimetypes
from datetime import datetime
from typing import Dict, List, Optional, Any, Union, Tuple
from dataclasses import dataclass
from enum import Enum
import requests
import base64
from pathlib import Path

# Audio processing
import speech_recognition as sr
from pydub import AudioSegment

# Document processing
from PyPDF2 import PdfReader
import docx
from PIL import Image
import pytesseract

# AI processing
from openai import AsyncOpenAI

# Computer vision
from vision.computer_vision import ContractorVisionAI, ImageContext, AnalysisType

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class InputType(Enum):
    TEXT = "text"
    IMAGE = "image"
    VOICE = "voice"
    DOCUMENT = "document"
    VIDEO = "video"
    LOCATION = "location"
    CONTACT = "contact"

class ProcessingStatus(Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"

@dataclass
class MultiModalInput:
    input_id: str
    input_type: InputType
    content: Any
    metadata: Dict[str, Any]
    timestamp: datetime
    source: str  # 'client', 'worker', 'system'
    job_id: Optional[int] = None
    worker_id: Optional[int] = None
    client_id: Optional[int] = None

@dataclass
class ProcessingResult:
    input_id: str
    status: ProcessingStatus
    processed_content: Dict[str, Any]
    confidence: float
    extracted_info: Dict[str, Any]
    ai_analysis: Dict[str, Any]
    actionable_items: List[str]
    requires_attention: bool
    processing_time: float
    error_message: Optional[str] = None

class MultiModalProcessor:
    """
    Advanced Multi-Modal Input Processor for Contractor AI
    
    Handles and processes various input types:
    - Text messages (WhatsApp, SMS, Email)
    - Images (job site photos, damage reports, progress updates)
    - Voice messages and calls
    - Documents (contracts, invoices, specifications)
    - Location data
    - Contact information
    """
    
    def __init__(self):
        self.client = AsyncOpenAI()
        self.vision_ai = ContractorVisionAI()
        self.speech_recognizer = sr.Recognizer()
        
        # Processing history
        self.processing_history = []
        
        # Initialize processors
        self._setup_processors()
        
    def _setup_processors(self):
        """Setup various processors and configurations"""
        self.config = {
            'max_file_size': 50 * 1024 * 1024,  # 50MB
            'supported_image_formats': ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp'],
            'supported_audio_formats': ['.mp3', '.wav', '.m4a', '.ogg', '.flac'],
            'supported_document_formats': ['.pdf', '.docx', '.doc', '.txt'],
            'supported_video_formats': ['.mp4', '.avi', '.mov', '.mkv'],
            'ocr_languages': ['eng', 'nld'],  # English and Dutch
            'confidence_threshold': 0.7
        }
        
        # Initialize speech recognition with noise reduction
        self.speech_recognizer.energy_threshold = 300
        self.speech_recognizer.dynamic_energy_threshold = True
        
    async def process_input(self, input_data: MultiModalInput) -> ProcessingResult:
        """
        Main entry point for processing multi-modal inputs
        """
        start_time = datetime.now()
        
        try:
            logger.info(f"Processing {input_data.input_type.value} input: {input_data.input_id}")
            
            # Route to appropriate processor
            if input_data.input_type == InputType.TEXT:
                result = await self._process_text_input(input_data)
            elif input_data.input_type == InputType.IMAGE:
                result = await self._process_image_input(input_data)
            elif input_data.input_type == InputType.VOICE:
                result = await self._process_voice_input(input_data)
            elif input_data.input_type == InputType.DOCUMENT:
                result = await self._process_document_input(input_data)
            elif input_data.input_type == InputType.VIDEO:
                result = await self._process_video_input(input_data)
            elif input_data.input_type == InputType.LOCATION:
                result = await self._process_location_input(input_data)
            elif input_data.input_type == InputType.CONTACT:
                result = await self._process_contact_input(input_data)
            else:
                raise ValueError(f"Unsupported input type: {input_data.input_type}")
            
            # Calculate processing time
            processing_time = (datetime.now() - start_time).total_seconds()
            result.processing_time = processing_time
            
            # Store processing history
            self._store_processing_result(input_data, result)
            
            logger.info(f"Successfully processed input {input_data.input_id} in {processing_time:.2f}s")
            
            return result
            
        except Exception as e:
            processing_time = (datetime.now() - start_time).total_seconds()
            logger.error(f"Error processing input {input_data.input_id}: {e}")
            
            return ProcessingResult(
                input_id=input_data.input_id,
                status=ProcessingStatus.FAILED,
                processed_content={},
                confidence=0.0,
                extracted_info={},
                ai_analysis={},
                actionable_items=[],
                requires_attention=True,
                processing_time=processing_time,
                error_message=str(e)
            )
    
    async def _process_text_input(self, input_data: MultiModalInput) -> ProcessingResult:
        """Process text input (messages, emails, etc.)"""
        try:
            text_content = input_data.content
            
            # Extract basic information
            extracted_info = self._extract_text_information(text_content)
            
            # AI analysis for intent and content
            ai_analysis = await self._analyze_text_with_ai(text_content, input_data.metadata)
            
            # Determine actionable items
            actionable_items = self._extract_actionable_items(ai_analysis)
            
            # Check if requires immediate attention
            requires_attention = self._check_urgency(ai_analysis)
            
            return ProcessingResult(
                input_id=input_data.input_id,
                status=ProcessingStatus.COMPLETED,
                processed_content={
                    'original_text': text_content,
                    'cleaned_text': self._clean_text(text_content),
                    'language': extracted_info.get('language', 'unknown'),
                    'word_count': len(text_content.split())
                },
                confidence=ai_analysis.get('confidence', 0.8),
                extracted_info=extracted_info,
                ai_analysis=ai_analysis,
                actionable_items=actionable_items,
                requires_attention=requires_attention,
                processing_time=0.0
            )
            
        except Exception as e:
            logger.error(f"Error processing text input: {e}")
            raise
    
    async def _process_image_input(self, input_data: MultiModalInput) -> ProcessingResult:
        """Process image input (photos, screenshots, etc.)"""
        try:
            image_path = input_data.content
            
            # Create image context
            context = ImageContext(
                job_id=input_data.job_id,
                job_type=input_data.metadata.get('job_type', 'general'),
                location=input_data.metadata.get('location', 'unknown'),
                timestamp=input_data.timestamp,
                worker_id=input_data.worker_id,
                phase=input_data.metadata.get('phase'),
                expected_outcome=input_data.metadata.get('expected_outcome')
            )
            
            # Determine analysis type based on metadata
            analysis_type = self._determine_image_analysis_type(input_data.metadata)
            
            # Perform vision analysis
            if analysis_type == AnalysisType.JOB_PROGRESS:
                vision_result = self.vision_ai.analyze_job_progress(image_path, context)
            elif analysis_type == AnalysisType.QUALITY_ASSESSMENT:
                vision_result = self.vision_ai.assess_work_quality(image_path, context)
            elif analysis_type == AnalysisType.SAFETY_INSPECTION:
                vision_result = self.vision_ai.inspect_safety_compliance(image_path, context)
            elif analysis_type == AnalysisType.DAMAGE_ASSESSMENT:
                vision_result = self.vision_ai.analyze_damage_assessment(image_path, context)
            else:
                vision_result = self.vision_ai.analyze_job_progress(image_path, context)
            
            # Extract text from image if present (OCR)
            ocr_text = self._extract_text_from_image(image_path)
            
            # Additional AI analysis
            ai_analysis = await self._analyze_image_context(input_data, vision_result, ocr_text)
            
            return ProcessingResult(
                input_id=input_data.input_id,
                status=ProcessingStatus.COMPLETED,
                processed_content={
                    'image_path': image_path,
                    'analysis_type': analysis_type.value,
                    'ocr_text': ocr_text,
                    'image_metadata': self._extract_image_metadata(image_path)
                },
                confidence=vision_result.confidence,
                extracted_info={
                    'progress_percentage': vision_result.progress_percentage,
                    'quality_score': vision_result.quality_score,
                    'objects_detected': vision_result.objects_detected,
                    'safety_issues': vision_result.safety_issues
                },
                ai_analysis={
                    'vision_analysis': vision_result.detailed_findings,
                    'context_analysis': ai_analysis,
                    'summary': vision_result.summary
                },
                actionable_items=vision_result.recommendations,
                requires_attention=vision_result.requires_attention,
                processing_time=0.0
            )
            
        except Exception as e:
            logger.error(f"Error processing image input: {e}")
            raise
    
    async def _process_voice_input(self, input_data: MultiModalInput) -> ProcessingResult:
        """Process voice input (voice messages, calls)"""
        try:
            audio_path = input_data.content
            
            # Convert audio to text
            transcription = self._transcribe_audio(audio_path)
            
            # Extract audio features
            audio_features = self._extract_audio_features(audio_path)
            
            # Process transcribed text
            text_input = MultiModalInput(
                input_id=f"{input_data.input_id}_text",
                input_type=InputType.TEXT,
                content=transcription,
                metadata={**input_data.metadata, 'source_type': 'voice'},
                timestamp=input_data.timestamp,
                source=input_data.source,
                job_id=input_data.job_id,
                worker_id=input_data.worker_id,
                client_id=input_data.client_id
            )
            
            text_result = await self._process_text_input(text_input)
            
            # Combine with audio analysis
            ai_analysis = await self._analyze_voice_context(input_data, transcription, audio_features)
            
            return ProcessingResult(
                input_id=input_data.input_id,
                status=ProcessingStatus.COMPLETED,
                processed_content={
                    'audio_path': audio_path,
                    'transcription': transcription,
                    'audio_features': audio_features,
                    'duration': audio_features.get('duration', 0)
                },
                confidence=min(text_result.confidence, audio_features.get('transcription_confidence', 0.8)),
                extracted_info={
                    **text_result.extracted_info,
                    'audio_quality': audio_features.get('quality', 'good'),
                    'speaker_emotion': audio_features.get('emotion', 'neutral')
                },
                ai_analysis={
                    'text_analysis': text_result.ai_analysis,
                    'voice_analysis': ai_analysis,
                    'combined_summary': ai_analysis.get('summary', transcription)
                },
                actionable_items=text_result.actionable_items,
                requires_attention=text_result.requires_attention or audio_features.get('urgent_tone', False),
                processing_time=0.0
            )
            
        except Exception as e:
            logger.error(f"Error processing voice input: {e}")
            raise
    
    async def _process_document_input(self, input_data: MultiModalInput) -> ProcessingResult:
        """Process document input (PDFs, Word docs, etc.)"""
        try:
            document_path = input_data.content
            
            # Extract text from document
            document_text = self._extract_text_from_document(document_path)
            
            # Extract document metadata
            doc_metadata = self._extract_document_metadata(document_path)
            
            # Process extracted text
            text_input = MultiModalInput(
                input_id=f"{input_data.input_id}_text",
                input_type=InputType.TEXT,
                content=document_text,
                metadata={**input_data.metadata, 'source_type': 'document', **doc_metadata},
                timestamp=input_data.timestamp,
                source=input_data.source,
                job_id=input_data.job_id,
                worker_id=input_data.worker_id,
                client_id=input_data.client_id
            )
            
            text_result = await self._process_text_input(text_input)
            
            # Additional document-specific analysis
            doc_analysis = await self._analyze_document_context(input_data, document_text, doc_metadata)
            
            return ProcessingResult(
                input_id=input_data.input_id,
                status=ProcessingStatus.COMPLETED,
                processed_content={
                    'document_path': document_path,
                    'extracted_text': document_text,
                    'document_type': doc_metadata.get('type', 'unknown'),
                    'page_count': doc_metadata.get('page_count', 1),
                    'file_size': doc_metadata.get('file_size', 0)
                },
                confidence=text_result.confidence,
                extracted_info={
                    **text_result.extracted_info,
                    'document_structure': doc_analysis.get('structure', {}),
                    'key_sections': doc_analysis.get('sections', [])
                },
                ai_analysis={
                    'text_analysis': text_result.ai_analysis,
                    'document_analysis': doc_analysis,
                    'summary': doc_analysis.get('summary', document_text[:200] + '...')
                },
                actionable_items=text_result.actionable_items + doc_analysis.get('action_items', []),
                requires_attention=text_result.requires_attention or doc_analysis.get('requires_review', False),
                processing_time=0.0
            )
            
        except Exception as e:
            logger.error(f"Error processing document input: {e}")
            raise
    
    async def _process_video_input(self, input_data: MultiModalInput) -> ProcessingResult:
        """Process video input (job site videos, tutorials, etc.)"""
        try:
            video_path = input_data.content
            
            # Extract frames from video
            frames = self._extract_video_frames(video_path)
            
            # Extract audio from video
            audio_path = self._extract_audio_from_video(video_path)
            
            # Process key frames as images
            frame_results = []
            for i, frame_path in enumerate(frames[:5]):  # Process first 5 frames
                frame_input = MultiModalInput(
                    input_id=f"{input_data.input_id}_frame_{i}",
                    input_type=InputType.IMAGE,
                    content=frame_path,
                    metadata={**input_data.metadata, 'frame_number': i},
                    timestamp=input_data.timestamp,
                    source=input_data.source,
                    job_id=input_data.job_id,
                    worker_id=input_data.worker_id,
                    client_id=input_data.client_id
                )
                
                frame_result = await self._process_image_input(frame_input)
                frame_results.append(frame_result)
            
            # Process audio if present
            audio_result = None
            if audio_path and os.path.getsize(audio_path) > 0:
                audio_input = MultiModalInput(
                    input_id=f"{input_data.input_id}_audio",
                    input_type=InputType.VOICE,
                    content=audio_path,
                    metadata={**input_data.metadata, 'source_type': 'video_audio'},
                    timestamp=input_data.timestamp,
                    source=input_data.source,
                    job_id=input_data.job_id,
                    worker_id=input_data.worker_id,
                    client_id=input_data.client_id
                )
                
                audio_result = await self._process_voice_input(audio_input)
            
            # Combine video analysis
            video_analysis = await self._analyze_video_context(input_data, frame_results, audio_result)
            
            # Aggregate results
            all_actionable_items = []
            requires_attention = False
            
            for frame_result in frame_results:
                all_actionable_items.extend(frame_result.actionable_items)
                requires_attention = requires_attention or frame_result.requires_attention
            
            if audio_result:
                all_actionable_items.extend(audio_result.actionable_items)
                requires_attention = requires_attention or audio_result.requires_attention
            
            return ProcessingResult(
                input_id=input_data.input_id,
                status=ProcessingStatus.COMPLETED,
                processed_content={
                    'video_path': video_path,
                    'frame_count': len(frames),
                    'duration': video_analysis.get('duration', 0),
                    'has_audio': audio_result is not None
                },
                confidence=video_analysis.get('confidence', 0.7),
                extracted_info={
                    'frame_analyses': [fr.extracted_info for fr in frame_results],
                    'audio_analysis': audio_result.extracted_info if audio_result else {},
                    'video_summary': video_analysis.get('summary', '')
                },
                ai_analysis={
                    'frame_analyses': [fr.ai_analysis for fr in frame_results],
                    'audio_analysis': audio_result.ai_analysis if audio_result else {},
                    'video_analysis': video_analysis
                },
                actionable_items=list(set(all_actionable_items)),  # Remove duplicates
                requires_attention=requires_attention,
                processing_time=0.0
            )
            
        except Exception as e:
            logger.error(f"Error processing video input: {e}")
            raise
    
    async def _process_location_input(self, input_data: MultiModalInput) -> ProcessingResult:
        """Process location input (GPS coordinates, addresses)"""
        try:
            location_data = input_data.content
            
            # Validate and normalize location data
            normalized_location = self._normalize_location_data(location_data)
            
            # Get location context (weather, nearby services, etc.)
            location_context = await self._get_location_context(normalized_location)
            
            # AI analysis for location relevance
            ai_analysis = await self._analyze_location_context(input_data, normalized_location, location_context)
            
            return ProcessingResult(
                input_id=input_data.input_id,
                status=ProcessingStatus.COMPLETED,
                processed_content={
                    'original_location': location_data,
                    'normalized_location': normalized_location,
                    'location_type': normalized_location.get('type', 'unknown')
                },
                confidence=normalized_location.get('confidence', 0.8),
                extracted_info={
                    'address': normalized_location.get('address', ''),
                    'coordinates': normalized_location.get('coordinates', {}),
                    'weather': location_context.get('weather', {}),
                    'accessibility': location_context.get('accessibility', {})
                },
                ai_analysis=ai_analysis,
                actionable_items=ai_analysis.get('recommendations', []),
                requires_attention=ai_analysis.get('requires_attention', False),
                processing_time=0.0
            )
            
        except Exception as e:
            logger.error(f"Error processing location input: {e}")
            raise
    
    async def _process_contact_input(self, input_data: MultiModalInput) -> ProcessingResult:
        """Process contact input (phone numbers, emails, vCards)"""
        try:
            contact_data = input_data.content
            
            # Parse and validate contact information
            parsed_contact = self._parse_contact_data(contact_data)
            
            # AI analysis for contact relevance
            ai_analysis = await self._analyze_contact_context(input_data, parsed_contact)
            
            return ProcessingResult(
                input_id=input_data.input_id,
                status=ProcessingStatus.COMPLETED,
                processed_content={
                    'original_contact': contact_data,
                    'parsed_contact': parsed_contact,
                    'contact_type': parsed_contact.get('type', 'unknown')
                },
                confidence=parsed_contact.get('confidence', 0.9),
                extracted_info=parsed_contact,
                ai_analysis=ai_analysis,
                actionable_items=ai_analysis.get('recommendations', []),
                requires_attention=ai_analysis.get('requires_attention', False),
                processing_time=0.0
            )
            
        except Exception as e:
            logger.error(f"Error processing contact input: {e}")
            raise
    
    # Text Processing Methods
    def _extract_text_information(self, text: str) -> Dict[str, Any]:
        """Extract basic information from text"""
        try:
            info = {}
            
            # Language detection (simple heuristic)
            dutch_words = ['en', 'het', 'de', 'van', 'is', 'een', 'voor', 'met', 'op', 'aan']
            english_words = ['the', 'and', 'is', 'a', 'to', 'of', 'in', 'for', 'with', 'on']
            
            text_lower = text.lower()
            dutch_count = sum(1 for word in dutch_words if word in text_lower)
            english_count = sum(1 for word in english_words if word in text_lower)
            
            if dutch_count > english_count:
                info['language'] = 'dutch'
            else:
                info['language'] = 'english'
            
            # Extract potential phone numbers
            import re
            phone_pattern = r'(\+31|0)[0-9\s\-]{8,}'
            phones = re.findall(phone_pattern, text)
            info['phone_numbers'] = phones
            
            # Extract potential email addresses
            email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
            emails = re.findall(email_pattern, text)
            info['email_addresses'] = emails
            
            # Extract potential addresses (Dutch format)
            address_pattern = r'\b\d{4}\s?[A-Z]{2}\b'
            postal_codes = re.findall(address_pattern, text)
            info['postal_codes'] = postal_codes
            
            # Extract potential dates
            date_pattern = r'\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b'
            dates = re.findall(date_pattern, text)
            info['dates'] = dates
            
            # Extract potential times
            time_pattern = r'\b\d{1,2}:\d{2}\b'
            times = re.findall(time_pattern, text)
            info['times'] = times
            
            # Sentiment analysis (simple)
            positive_words = ['good', 'great', 'excellent', 'perfect', 'happy', 'satisfied', 'goed', 'geweldig', 'perfect', 'tevreden']
            negative_words = ['bad', 'terrible', 'awful', 'problem', 'issue', 'complaint', 'slecht', 'probleem', 'klacht']
            
            positive_count = sum(1 for word in positive_words if word in text_lower)
            negative_count = sum(1 for word in negative_words if word in text_lower)
            
            if positive_count > negative_count:
                info['sentiment'] = 'positive'
            elif negative_count > positive_count:
                info['sentiment'] = 'negative'
            else:
                info['sentiment'] = 'neutral'
            
            return info
            
        except Exception as e:
            logger.error(f"Error extracting text information: {e}")
            return {}
    
    async def _analyze_text_with_ai(self, text: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze text content with AI"""
        try:
            prompt = f"""
            Analyze this message from a contractor's perspective:
            
            Text: "{text}"
            
            Context: {json.dumps(metadata, indent=2)}
            
            Provide analysis including:
            1. Intent (job_request, progress_update, complaint, question, emergency, etc.)
            2. Urgency level (low, medium, high, critical)
            3. Key information extracted
            4. Required actions
            5. Confidence level
            6. Summary
            
            Format as JSON.
            """
            
            response = await self.client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=400
            )
            
            # Parse AI response
            ai_text = response.choices[0].message.content
            
            try:
                import re
                json_match = re.search(r'\{.*\}', ai_text, re.DOTALL)
                if json_match:
                    return json.loads(json_match.group())
                else:
                    return {
                        'summary': ai_text,
                        'confidence': 0.7,
                        'intent': 'unknown',
                        'urgency': 'medium'
                    }
            except json.JSONDecodeError:
                return {
                    'summary': ai_text,
                    'confidence': 0.6,
                    'intent': 'unknown',
                    'urgency': 'medium'
                }
                
        except Exception as e:
            logger.error(f"Error analyzing text with AI: {e}")
            return {
                'summary': text[:100] + '...' if len(text) > 100 else text,
                'confidence': 0.5,
                'intent': 'unknown',
                'urgency': 'medium',
                'error': str(e)
            }
    
    def _clean_text(self, text: str) -> str:
        """Clean and normalize text"""
        try:
            # Remove extra whitespace
            cleaned = ' '.join(text.split())
            
            # Remove special characters but keep basic punctuation
            import re
            cleaned = re.sub(r'[^\w\s\.,!?;:\-\(\)]', '', cleaned)
            
            return cleaned
            
        except Exception as e:
            logger.error(f"Error cleaning text: {e}")
            return text
    
    def _extract_actionable_items(self, ai_analysis: Dict[str, Any]) -> List[str]:
        """Extract actionable items from AI analysis"""
        try:
            actions = []
            
            # From AI analysis
            if 'required_actions' in ai_analysis:
                if isinstance(ai_analysis['required_actions'], list):
                    actions.extend(ai_analysis['required_actions'])
                else:
                    actions.append(str(ai_analysis['required_actions']))
            
            # Based on intent
            intent = ai_analysis.get('intent', '').lower()
            if 'job_request' in intent:
                actions.append('Create new job entry')
                actions.append('Schedule initial consultation')
            elif 'complaint' in intent:
                actions.append('Investigate complaint')
                actions.append('Contact client for resolution')
            elif 'emergency' in intent:
                actions.append('Immediate response required')
                actions.append('Contact emergency services if needed')
            
            return actions
            
        except Exception as e:
            logger.error(f"Error extracting actionable items: {e}")
            return []
    
    def _check_urgency(self, ai_analysis: Dict[str, Any]) -> bool:
        """Check if input requires immediate attention"""
        try:
            urgency = ai_analysis.get('urgency', 'medium').lower()
            intent = ai_analysis.get('intent', '').lower()
            
            # High urgency indicators
            if urgency in ['high', 'critical']:
                return True
            
            if any(keyword in intent for keyword in ['emergency', 'urgent', 'complaint', 'problem']):
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"Error checking urgency: {e}")
            return False
    
    # Image Processing Methods
    def _determine_image_analysis_type(self, metadata: Dict[str, Any]) -> AnalysisType:
        """Determine the type of image analysis needed"""
        try:
            purpose = metadata.get('purpose', '').lower()
            job_phase = metadata.get('phase', '').lower()
            
            if 'progress' in purpose or 'update' in purpose:
                return AnalysisType.JOB_PROGRESS
            elif 'quality' in purpose or 'inspection' in purpose:
                return AnalysisType.QUALITY_ASSESSMENT
            elif 'safety' in purpose or 'ppe' in purpose:
                return AnalysisType.SAFETY_INSPECTION
            elif 'damage' in purpose or 'problem' in purpose:
                return AnalysisType.DAMAGE_ASSESSMENT
            elif 'before' in purpose or 'after' in purpose:
                return AnalysisType.BEFORE_AFTER
            elif 'material' in purpose or 'tool' in purpose:
                return AnalysisType.MATERIAL_IDENTIFICATION
            else:
                return AnalysisType.JOB_PROGRESS  # Default
                
        except Exception as e:
            logger.error(f"Error determining image analysis type: {e}")
            return AnalysisType.JOB_PROGRESS
    
    def _extract_text_from_image(self, image_path: str) -> str:
        """Extract text from image using OCR"""
        try:
            # Load image
            image = Image.open(image_path)
            
            # Perform OCR
            text = pytesseract.image_to_string(image, lang='eng+nld')
            
            return text.strip()
            
        except Exception as e:
            logger.error(f"Error extracting text from image: {e}")
            return ""
    
    def _extract_image_metadata(self, image_path: str) -> Dict[str, Any]:
        """Extract metadata from image file"""
        try:
            from PIL import Image
            from PIL.ExifTags import TAGS
            
            image = Image.open(image_path)
            metadata = {}
            
            # Basic info
            metadata['size'] = image.size
            metadata['mode'] = image.mode
            metadata['format'] = image.format
            
            # EXIF data
            exifdata = image.getexif()
            if exifdata:
                for tag_id in exifdata:
                    tag = TAGS.get(tag_id, tag_id)
                    data = exifdata.get(tag_id)
                    if isinstance(data, bytes):
                        data = data.decode()
                    metadata[tag] = data
            
            return metadata
            
        except Exception as e:
            logger.error(f"Error extracting image metadata: {e}")
            return {}
    
    async def _analyze_image_context(self, input_data: MultiModalInput, vision_result, ocr_text: str) -> Dict[str, Any]:
        """Analyze image in context with AI"""
        try:
            prompt = f"""
            Analyze this image in the context of a contractor business:
            
            Vision Analysis Summary: {vision_result.summary}
            OCR Text Found: "{ocr_text}"
            Input Metadata: {json.dumps(input_data.metadata, indent=2)}
            Source: {input_data.source}
            
            Provide contextual analysis including:
            1. Business relevance
            2. Next steps recommended
            3. Client communication needed
            4. Priority level
            5. Integration with job workflow
            
            Format as JSON.
            """
            
            response = await self.client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=300
            )
            
            ai_text = response.choices[0].message.content
            
            try:
                import re
                json_match = re.search(r'\{.*\}', ai_text, re.DOTALL)
                if json_match:
                    return json.loads(json_match.group())
                else:
                    return {'summary': ai_text, 'confidence': 0.7}
            except json.JSONDecodeError:
                return {'summary': ai_text, 'confidence': 0.6}
                
        except Exception as e:
            logger.error(f"Error analyzing image context: {e}")
            return {'summary': 'Image context analysis failed', 'confidence': 0.5}
    
    # Audio Processing Methods
    def _transcribe_audio(self, audio_path: str) -> str:
        """Transcribe audio to text"""
        try:
            # Convert audio to WAV if needed
            audio = AudioSegment.from_file(audio_path)
            
            # Export as WAV for speech recognition
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_wav:
                audio.export(temp_wav.name, format='wav')
                
                # Transcribe
                with sr.AudioFile(temp_wav.name) as source:
                    audio_data = self.speech_recognizer.record(source)
                    
                try:
                    # Try Google Speech Recognition first
                    text = self.speech_recognizer.recognize_google(audio_data, language='nl-NL')
                except sr.UnknownValueError:
                    try:
                        # Fallback to English
                        text = self.speech_recognizer.recognize_google(audio_data, language='en-US')
                    except sr.UnknownValueError:
                        text = "[Audio unclear - could not transcribe]"
                except sr.RequestError:
                    text = "[Transcription service unavailable]"
                
                # Clean up temp file
                os.unlink(temp_wav.name)
                
                return text
                
        except Exception as e:
            logger.error(f"Error transcribing audio: {e}")
            return "[Transcription failed]"
    
    def _extract_audio_features(self, audio_path: str) -> Dict[str, Any]:
        """Extract features from audio"""
        try:
            audio = AudioSegment.from_file(audio_path)
            
            features = {
                'duration': len(audio) / 1000.0,  # Convert to seconds
                'channels': audio.channels,
                'frame_rate': audio.frame_rate,
                'sample_width': audio.sample_width,
                'max_dBFS': audio.max_dBFS,
                'rms': audio.rms,
                'quality': 'good' if audio.frame_rate >= 16000 else 'low',
                'transcription_confidence': 0.8,  # Placeholder
                'emotion': 'neutral',  # Placeholder for emotion detection
                'urgent_tone': audio.max_dBFS > -10  # Simple volume-based urgency
            }
            
            return features
            
        except Exception as e:
            logger.error(f"Error extracting audio features: {e}")
            return {'duration': 0, 'quality': 'unknown'}
    
    async def _analyze_voice_context(self, input_data: MultiModalInput, transcription: str, audio_features: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze voice message in context"""
        try:
            prompt = f"""
            Analyze this voice message from a contractor business perspective:
            
            Transcription: "{transcription}"
            Audio Duration: {audio_features.get('duration', 0)} seconds
            Audio Quality: {audio_features.get('quality', 'unknown')}
            Source: {input_data.source}
            Context: {json.dumps(input_data.metadata, indent=2)}
            
            Provide analysis including:
            1. Message intent and urgency
            2. Emotional tone assessment
            3. Required follow-up actions
            4. Communication preferences inferred
            5. Summary for records
            
            Format as JSON.
            """
            
            response = self.client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=300
            )
            
            ai_text = response.choices[0].message.content
            
            try:
                import re
                json_match = re.search(r'\{.*\}', ai_text, re.DOTALL)
                if json_match:
                    return json.loads(json_match.group())
                else:
                    return {'summary': ai_text, 'confidence': 0.7}
            except json.JSONDecodeError:
                return {'summary': ai_text, 'confidence': 0.6}
                
        except Exception as e:
            logger.error(f"Error analyzing voice context: {e}")
            return {'summary': 'Voice analysis failed', 'confidence': 0.5}
    
    # Document Processing Methods
    def _extract_text_from_document(self, document_path: str) -> str:
        """Extract text from various document formats"""
        try:
            file_extension = Path(document_path).suffix.lower()
            
            if file_extension == '.pdf':
                return self._extract_text_from_pdf(document_path)
            elif file_extension in ['.docx', '.doc']:
                return self._extract_text_from_word(document_path)
            elif file_extension == '.txt':
                with open(document_path, 'r', encoding='utf-8') as file:
                    return file.read()
            else:
                raise ValueError(f"Unsupported document format: {file_extension}")
                
        except Exception as e:
            logger.error(f"Error extracting text from document: {e}")
            return f"[Error extracting text: {str(e)}]"
    
    def _extract_text_from_pdf(self, pdf_path: str) -> str:
        """Extract text from PDF"""
        try:
            reader = PdfReader(pdf_path)
            text = ""
            
            for page in reader.pages:
                text += page.extract_text() + "\n"
            
            return text.strip()
            
        except Exception as e:
            logger.error(f"Error extracting text from PDF: {e}")
            return f"[PDF extraction failed: {str(e)}]"
    
    def _extract_text_from_word(self, word_path: str) -> str:
        """Extract text from Word document"""
        try:
            doc = docx.Document(word_path)
            text = ""
            
            for paragraph in doc.paragraphs:
                text += paragraph.text + "\n"
            
            return text.strip()
            
        except Exception as e:
            logger.error(f"Error extracting text from Word document: {e}")
            return f"[Word extraction failed: {str(e)}]"
    
    def _extract_document_metadata(self, document_path: str) -> Dict[str, Any]:
        """Extract metadata from document"""
        try:
            file_path = Path(document_path)
            file_stats = file_path.stat()
            
            metadata = {
                'filename': file_path.name,
                'file_size': file_stats.st_size,
                'created': datetime.fromtimestamp(file_stats.st_ctime),
                'modified': datetime.fromtimestamp(file_stats.st_mtime),
                'type': file_path.suffix.lower()
            }
            
            # Try to get additional metadata based on file type
            if file_path.suffix.lower() == '.pdf':
                try:
                    reader = PdfReader(document_path)
                    metadata['page_count'] = len(reader.pages)
                    if reader.metadata:
                        metadata.update({
                            'title': reader.metadata.get('/Title', ''),
                            'author': reader.metadata.get('/Author', ''),
                            'subject': reader.metadata.get('/Subject', ''),
                            'creator': reader.metadata.get('/Creator', '')
                        })
                except:
                    pass
            
            return metadata
            
        except Exception as e:
            logger.error(f"Error extracting document metadata: {e}")
            return {}
    
    async def _analyze_document_context(self, input_data: MultiModalInput, document_text: str, doc_metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze document in business context"""
        try:
            prompt = f"""
            Analyze this document from a contractor business perspective:
            
            Document Type: {doc_metadata.get('type', 'unknown')}
            Document Text (first 500 chars): "{document_text[:500]}..."
            Metadata: {json.dumps({k: str(v) for k, v in doc_metadata.items()}, indent=2)}
            Source: {input_data.source}
            
            Provide analysis including:
            1. Document purpose and relevance
            2. Key information extracted
            3. Action items required
            4. Filing/storage recommendations
            5. Follow-up needed
            6. Business impact assessment
            
            Format as JSON.
            """
            
            response = await self.client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=400
            )
            
            ai_text = response.choices[0].message.content
            
            try:
                import re
                json_match = re.search(r'\{.*\}', ai_text, re.DOTALL)
                if json_match:
                    return json.loads(json_match.group())
                else:
                    return {'summary': ai_text, 'confidence': 0.7}
            except json.JSONDecodeError:
                return {'summary': ai_text, 'confidence': 0.6}
                
        except Exception as e:
            logger.error(f"Error analyzing document context: {e}")
            return {'summary': 'Document analysis failed', 'confidence': 0.5}
    
    # Video Processing Methods (Stubs - would require more advanced video processing libraries)
    def _extract_video_frames(self, video_path: str) -> List[str]:
        """Extract key frames from video"""
        # Placeholder implementation
        # In a real implementation, you would use OpenCV or similar to extract frames
        return []
    
    def _extract_audio_from_video(self, video_path: str) -> str:
        """Extract audio track from video"""
        # Placeholder implementation
        # In a real implementation, you would use ffmpeg or similar
        return ""
    
    async def _analyze_video_context(self, input_data: MultiModalInput, frame_results: List, audio_result) -> Dict[str, Any]:
        """Analyze video in business context"""
        # Placeholder implementation
        return {
            'summary': 'Video analysis completed',
            'confidence': 0.7,
            'duration': 0,
            'frame_count': len(frame_results)
        }
    
    # Location Processing Methods
    def _normalize_location_data(self, location_data: Any) -> Dict[str, Any]:
        """Normalize location data to standard format"""
        try:
            if isinstance(location_data, str):
                # Try to parse as address
                return {
                    'address': location_data,
                    'type': 'address',
                    'confidence': 0.8
                }
            elif isinstance(location_data, dict):
                # Already structured
                return location_data
            else:
                return {
                    'raw_data': str(location_data),
                    'type': 'unknown',
                    'confidence': 0.5
                }
                
        except Exception as e:
            logger.error(f"Error normalizing location data: {e}")
            return {'error': str(e), 'confidence': 0.0}
    
    async def _get_location_context(self, normalized_location: Dict[str, Any]) -> Dict[str, Any]:
        """Get contextual information about location"""
        # Placeholder for weather API, maps API, etc.
        return {
            'weather': {'condition': 'unknown'},
            'accessibility': {'parking': 'unknown'}
        }
    
    async def _analyze_location_context(self, input_data: MultiModalInput, normalized_location: Dict[str, Any], location_context: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze location in business context"""
        return {
            'summary': f"Location analysis for {normalized_location.get('address', 'unknown location')}",
            'confidence': 0.8,
            'recommendations': ['Verify location before job scheduling']
        }
    
    # Contact Processing Methods
    def _parse_contact_data(self, contact_data: Any) -> Dict[str, Any]:
        """Parse contact information"""
        try:
            if isinstance(contact_data, str):
                # Try to parse phone/email
                import re
                
                # Check if it's a phone number
                phone_pattern = r'(\+31|0)[0-9\s\-]{8,}'
                if re.match(phone_pattern, contact_data):
                    return {
                        'phone': contact_data,
                        'type': 'phone',
                        'confidence': 0.9
                    }
                
                # Check if it's an email
                email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
                if re.match(email_pattern, contact_data):
                    return {
                        'email': contact_data,
                        'type': 'email',
                        'confidence': 0.9
                    }
                
                return {
                    'raw_data': contact_data,
                    'type': 'unknown',
                    'confidence': 0.5
                }
            
            return contact_data
            
        except Exception as e:
            logger.error(f"Error parsing contact data: {e}")
            return {'error': str(e), 'confidence': 0.0}
    
    async def _analyze_contact_context(self, input_data: MultiModalInput, parsed_contact: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze contact in business context"""
        return {
            'summary': f"Contact information processed: {parsed_contact.get('type', 'unknown')}",
            'confidence': 0.8,
            'recommendations': ['Add to contact database']
        }
    
    # Utility Methods
    def _store_processing_result(self, input_data: MultiModalInput, result: ProcessingResult):
        """Store processing result for learning and improvement"""
        try:
            record = {
                'timestamp': datetime.now(),
                'input_data': input_data,
                'result': result
            }
            
            self.processing_history.append(record)
            
            # Keep only recent history (last 1000 records)
            if len(self.processing_history) > 1000:
                self.processing_history = self.processing_history[-1000:]
                
        except Exception as e:
            logger.error(f"Error storing processing result: {e}")
    
    def get_processing_history(self, input_type: Optional[InputType] = None, job_id: Optional[int] = None) -> List[Dict[str, Any]]:
        """Get processing history with optional filters"""
        history = self.processing_history
        
        if input_type:
            history = [record for record in history if record['input_data'].input_type == input_type]
        
        if job_id:
            history = [record for record in history if record['input_data'].job_id == job_id]
        
        return history
    
    def get_processing_stats(self) -> Dict[str, Any]:
        """Get processing statistics"""
        try:
            total_processed = len(self.processing_history)
            
            if total_processed == 0:
                return {'total_processed': 0}
            
            # Count by input type
            type_counts = {}
            status_counts = {}
            avg_processing_times = {}
            
            for record in self.processing_history:
                input_type = record['input_data'].input_type.value
                status = record['result'].status.value
                processing_time = record['result'].processing_time
                
                type_counts[input_type] = type_counts.get(input_type, 0) + 1
                status_counts[status] = status_counts.get(status, 0) + 1
                
                if input_type not in avg_processing_times:
                    avg_processing_times[input_type] = []
                avg_processing_times[input_type].append(processing_time)
            
            # Calculate averages
            for input_type in avg_processing_times:
                times = avg_processing_times[input_type]
                avg_processing_times[input_type] = sum(times) / len(times)
            
            return {
                'total_processed': total_processed,
                'type_counts': type_counts,
                'status_counts': status_counts,
                'avg_processing_times': avg_processing_times,
                'success_rate': status_counts.get('completed', 0) / total_processed
            }
            
        except Exception as e:
            logger.error(f"Error getting processing stats: {e}")
            return {'error': str(e)}

