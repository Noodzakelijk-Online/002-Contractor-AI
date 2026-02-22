import os
import json
import logging
import base64
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from enum import Enum
import requests
from PIL import Image, ImageDraw, ImageFont
import cv2
import numpy as np
from openai import OpenAI, AsyncOpenAI

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AnalysisType(Enum):
    JOB_PROGRESS = "job_progress"
    QUALITY_ASSESSMENT = "quality_assessment"
    SAFETY_INSPECTION = "safety_inspection"
    MATERIAL_IDENTIFICATION = "material_identification"
    DAMAGE_ASSESSMENT = "damage_assessment"
    BEFORE_AFTER = "before_after"
    TOOL_RECOGNITION = "tool_recognition"
    WORKER_ACTIVITY = "worker_activity"

class QualityLevel(Enum):
    EXCELLENT = "excellent"
    GOOD = "good"
    ACCEPTABLE = "acceptable"
    POOR = "poor"
    UNACCEPTABLE = "unacceptable"

@dataclass
class VisionAnalysisResult:
    analysis_type: AnalysisType
    confidence: float
    summary: str
    detailed_findings: Dict[str, Any]
    quality_score: float
    safety_issues: List[str]
    recommendations: List[str]
    objects_detected: List[Dict[str, Any]]
    progress_percentage: Optional[float] = None
    estimated_completion_time: Optional[str] = None
    requires_attention: bool = False

@dataclass
class ImageContext:
    job_id: Optional[int]
    job_type: str
    location: str
    timestamp: datetime
    worker_id: Optional[int] = None
    phase: Optional[str] = None
    expected_outcome: Optional[str] = None

class ContractorVisionAI:
    """
    Advanced Computer Vision AI for Contractor Business
    
    Provides intelligent image analysis for:
    - Job progress tracking
    - Quality assessment
    - Safety compliance
    - Material identification
    - Damage assessment
    - Before/after comparisons
    """
    
    def __init__(self):
        self.client = AsyncOpenAI()
        self.analysis_history = []
        
        # Initialize computer vision models
        self._setup_cv_models()
        
    def _setup_cv_models(self):
        """Setup computer vision models and configurations"""
        self.cv_config = {
            'confidence_threshold': 0.7,
            'quality_threshold': 0.8,
            'safety_threshold': 0.9,
            'supported_formats': ['.jpg', '.jpeg', '.png', '.bmp', '.tiff'],
            'max_image_size': (2048, 2048),
            'min_image_size': (224, 224)
        }
        
    async def analyze_job_progress(self, image_path: str, context: ImageContext) -> VisionAnalysisResult:
        """
        Analyze job progress from site photos
        """
        try:
            # Preprocess image
            processed_image = self._preprocess_image(image_path)
            
            # Encode image for AI analysis
            base64_image = self._encode_image_to_base64(processed_image)
            
            # Create analysis prompt
            prompt = self._create_progress_analysis_prompt(context)
            
            # Analyze with GPT-4 Vision
            response = await self.client.chat.completions.create(
                model="gpt-4-vision-preview",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{base64_image}"
                                }
                            }
                        ]
                    }
                ],
                max_tokens=500
            )
            
            # Parse AI response
            ai_analysis = self._parse_vision_response(response.choices[0].message.content)
            
            # Perform additional computer vision analysis
            cv_analysis = self._perform_cv_analysis(processed_image, context)
            
            # Combine AI and CV results
            result = self._combine_analysis_results(ai_analysis, cv_analysis, context)
            
            # Store analysis for learning
            self._store_analysis(result, context)
            
            return result
            
        except Exception as e:
            logger.error(f"Error analyzing job progress: {e}")
            return self._create_fallback_analysis()
    
    async def assess_work_quality(self, image_path: str, context: ImageContext, reference_images: List[str] = None) -> VisionAnalysisResult:
        """
        Assess work quality by comparing with standards and reference images
        """
        try:
            # Process main image
            main_image = self._preprocess_image(image_path)
            base64_main = self._encode_image_to_base64(main_image)
            
            # Process reference images if provided
            reference_data = []
            if reference_images:
                for ref_path in reference_images:
                    ref_image = self._preprocess_image(ref_path)
                    ref_base64 = self._encode_image_to_base64(ref_image)
                    reference_data.append(ref_base64)
            
            # Create quality assessment prompt
            prompt = self._create_quality_assessment_prompt(context, len(reference_data))
            
            # Prepare messages for AI
            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{base64_main}"}
                        }
                    ]
                }
            ]
            
            # Add reference images to analysis
            for i, ref_data in enumerate(reference_data):
                messages[0]["content"].append({
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{ref_data}"}
                })
            
            response = await self.client.chat.completions.create(
                model="gpt-4-vision-preview",
                messages=messages,
                max_tokens=600
            )
            
            # Parse and process results
            ai_analysis = self._parse_vision_response(response.choices[0].message.content)
            cv_analysis = self._perform_quality_cv_analysis(main_image, context)
            
            result = self._combine_quality_results(ai_analysis, cv_analysis, context)
            
            self._store_analysis(result, context)
            
            return result
            
        except Exception as e:
            logger.error(f"Error assessing work quality: {e}")
            return self._create_fallback_analysis()
    
    async def inspect_safety_compliance(self, image_path: str, context: ImageContext) -> VisionAnalysisResult:
        """
        Inspect safety compliance from job site photos
        """
        try:
            processed_image = self._preprocess_image(image_path)
            base64_image = self._encode_image_to_base64(processed_image)
            
            # Create safety inspection prompt
            prompt = self._create_safety_inspection_prompt(context)
            
            response = await self.client.chat.completions.create(
                model="gpt-4-vision-preview",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}
                            }
                        ]
                    }
                ],
                max_tokens=400
            )
            
            # Parse safety analysis
            ai_analysis = self._parse_vision_response(response.choices[0].message.content)
            
            # Perform computer vision safety checks
            cv_safety = self._perform_safety_cv_analysis(processed_image, context)
            
            result = self._combine_safety_results(ai_analysis, cv_safety, context)
            
            self._store_analysis(result, context)
            
            return result
            
        except Exception as e:
            logger.error(f"Error inspecting safety compliance: {e}")
            return self._create_fallback_analysis()
    
    async def identify_materials_and_tools(self, image_path: str, context: ImageContext) -> VisionAnalysisResult:
        """
        Identify materials and tools in job site photos
        """
        try:
            processed_image = self._preprocess_image(image_path)
            base64_image = self._encode_image_to_base64(processed_image)
            
            # Create material identification prompt
            prompt = self._create_material_identification_prompt(context)
            
            response = await self.client.chat.completions.create(
                model="gpt-4-vision-preview",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}
                            }
                        ]
                    }
                ],
                max_tokens=400
            )
            
            # Parse material analysis
            ai_analysis = self._parse_vision_response(response.choices[0].message.content)
            
            # Perform object detection
            cv_objects = self._perform_object_detection(processed_image)
            
            result = self._combine_material_results(ai_analysis, cv_objects, context)
            
            self._store_analysis(result, context)
            
            return result
            
        except Exception as e:
            logger.error(f"Error identifying materials and tools: {e}")
            return self._create_fallback_analysis()
    
    async def compare_before_after(self, before_image: str, after_image: str, context: ImageContext) -> VisionAnalysisResult:
        """
        Compare before and after photos to assess transformation
        """
        try:
            # Process both images
            before_processed = self._preprocess_image(before_image)
            after_processed = self._preprocess_image(after_image)
            
            before_base64 = self._encode_image_to_base64(before_processed)
            after_base64 = self._encode_image_to_base64(after_processed)
            
            # Create comparison prompt
            prompt = self._create_comparison_prompt(context)
            
            response = await self.client.chat.completions.create(
                model="gpt-4-vision-preview",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{before_base64}"}
                            },
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{after_base64}"}
                            }
                        ]
                    }
                ],
                max_tokens=500
            )
            
            # Parse comparison analysis
            ai_analysis = self._parse_vision_response(response.choices[0].message.content)
            
            # Perform computer vision comparison
            cv_comparison = self._perform_cv_comparison(before_processed, after_processed)
            
            result = self._combine_comparison_results(ai_analysis, cv_comparison, context)
            
            self._store_analysis(result, context)
            
            return result
            
        except Exception as e:
            logger.error(f"Error comparing before/after images: {e}")
            return self._create_fallback_analysis()
    
    async def analyze_damage_assessment(self, image_path: str, context: ImageContext) -> VisionAnalysisResult:
        """
        Analyze damage in photos for assessment and repair planning
        """
        try:
            processed_image = self._preprocess_image(image_path)
            base64_image = self._encode_image_to_base64(processed_image)
            
            # Create damage assessment prompt
            prompt = self._create_damage_assessment_prompt(context)
            
            response = await self.client.chat.completions.create(
                model="gpt-4-vision-preview",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}
                            }
                        ]
                    }
                ],
                max_tokens=500
            )
            
            # Parse damage analysis
            ai_analysis = self._parse_vision_response(response.choices[0].message.content)
            
            # Perform damage detection using CV
            cv_damage = self._perform_damage_detection(processed_image)
            
            result = self._combine_damage_results(ai_analysis, cv_damage, context)
            
            self._store_analysis(result, context)
            
            return result
            
        except Exception as e:
            logger.error(f"Error analyzing damage: {e}")
            return self._create_fallback_analysis()
    
    # Image Processing Methods
    def _preprocess_image(self, image_path: str) -> np.ndarray:
        """Preprocess image for analysis"""
        try:
            # Load image
            if isinstance(image_path, str):
                image = cv2.imread(image_path)
            else:
                image = image_path
            
            if image is None:
                raise ValueError("Could not load image")
            
            # Resize if too large
            height, width = image.shape[:2]
            max_size = self.cv_config['max_image_size']
            
            if width > max_size[0] or height > max_size[1]:
                scale = min(max_size[0]/width, max_size[1]/height)
                new_width = int(width * scale)
                new_height = int(height * scale)
                image = cv2.resize(image, (new_width, new_height))
            
            # Enhance image quality
            image = self._enhance_image_quality(image)
            
            return image
            
        except Exception as e:
            logger.error(f"Error preprocessing image: {e}")
            raise
    
    def _enhance_image_quality(self, image: np.ndarray) -> np.ndarray:
        """Enhance image quality for better analysis"""
        try:
            # Convert to LAB color space for better processing
            lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
            
            # Apply CLAHE (Contrast Limited Adaptive Histogram Equalization)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
            lab[:,:,0] = clahe.apply(lab[:,:,0])
            
            # Convert back to BGR
            enhanced = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
            
            # Apply slight denoising
            enhanced = cv2.bilateralFilter(enhanced, 9, 75, 75)
            
            return enhanced
            
        except Exception as e:
            logger.error(f"Error enhancing image: {e}")
            return image
    
    def _encode_image_to_base64(self, image: np.ndarray) -> str:
        """Encode image to base64 for API transmission"""
        try:
            # Convert to PIL Image
            if len(image.shape) == 3:
                image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
                pil_image = Image.fromarray(image_rgb)
            else:
                pil_image = Image.fromarray(image)
            
            # Encode to base64
            import io
            buffer = io.BytesIO()
            pil_image.save(buffer, format='JPEG', quality=85)
            img_str = base64.b64encode(buffer.getvalue()).decode()
            
            return img_str
            
        except Exception as e:
            logger.error(f"Error encoding image to base64: {e}")
            raise
    
    # Computer Vision Analysis Methods
    def _perform_cv_analysis(self, image: np.ndarray, context: ImageContext) -> Dict[str, Any]:
        """Perform computer vision analysis on image"""
        try:
            results = {}
            
            # Edge detection for progress assessment
            edges = cv2.Canny(image, 50, 150)
            edge_density = np.sum(edges > 0) / edges.size
            results['edge_density'] = edge_density
            
            # Color analysis
            results['color_analysis'] = self._analyze_colors(image)
            
            # Texture analysis
            results['texture_analysis'] = self._analyze_texture(image)
            
            # Object detection (simplified)
            results['objects'] = self._detect_basic_objects(image)
            
            return results
            
        except Exception as e:
            logger.error(f"Error in CV analysis: {e}")
            return {}
    
    def _analyze_colors(self, image: np.ndarray) -> Dict[str, Any]:
        """Analyze color distribution in image"""
        try:
            # Convert to HSV for better color analysis
            hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
            
            # Calculate color histograms
            hist_h = cv2.calcHist([hsv], [0], None, [180], [0, 180])
            hist_s = cv2.calcHist([hsv], [1], None, [256], [0, 256])
            hist_v = cv2.calcHist([hsv], [2], None, [256], [0, 256])
            
            # Find dominant colors
            dominant_hue = np.argmax(hist_h)
            dominant_saturation = np.argmax(hist_s)
            dominant_value = np.argmax(hist_v)
            
            return {
                'dominant_hue': int(dominant_hue),
                'dominant_saturation': int(dominant_saturation),
                'dominant_brightness': int(dominant_value),
                'color_diversity': float(np.std(hist_h)),
                'overall_brightness': float(np.mean(hsv[:,:,2]))
            }
            
        except Exception as e:
            logger.error(f"Error analyzing colors: {e}")
            return {}
    
    def _analyze_texture(self, image: np.ndarray) -> Dict[str, Any]:
        """Analyze texture patterns in image"""
        try:
            # Convert to grayscale
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            
            # Calculate texture measures
            # Local Binary Pattern (simplified)
            texture_variance = float(np.var(gray))
            
            # Gradient analysis
            grad_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
            grad_y = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
            gradient_magnitude = np.sqrt(grad_x**2 + grad_y**2)
            
            return {
                'texture_variance': texture_variance,
                'gradient_strength': float(np.mean(gradient_magnitude)),
                'texture_uniformity': float(1.0 / (1.0 + texture_variance))
            }
            
        except Exception as e:
            logger.error(f"Error analyzing texture: {e}")
            return {}
    
    def _detect_basic_objects(self, image: np.ndarray) -> List[Dict[str, Any]]:
        """Detect basic objects using simple computer vision"""
        try:
            objects = []
            
            # Convert to grayscale
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            
            # Detect contours
            contours, _ = cv2.findContours(gray, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            for i, contour in enumerate(contours):
                area = cv2.contourArea(contour)
                if area > 1000:  # Filter small objects
                    x, y, w, h = cv2.boundingRect(contour)
                    
                    objects.append({
                        'id': i,
                        'type': 'unknown_object',
                        'bbox': [int(x), int(y), int(w), int(h)],
                        'area': float(area),
                        'confidence': 0.5
                    })
            
            return objects[:10]  # Limit to top 10 objects
            
        except Exception as e:
            logger.error(f"Error detecting objects: {e}")
            return []
    
    # Prompt Creation Methods
    def _create_progress_analysis_prompt(self, context: ImageContext) -> str:
        """Create prompt for job progress analysis"""
        return f"""
        Analyze this {context.job_type} job site image for progress assessment.
        
        Context:
        - Job Type: {context.job_type}
        - Location: {context.location}
        - Expected Phase: {context.phase or 'Unknown'}
        - Timestamp: {context.timestamp}
        
        Please analyze and provide:
        1. Progress percentage (0-100%)
        2. Current phase/stage of work
        3. Quality observations
        4. Any safety concerns
        5. Estimated completion time
        6. Recommendations for next steps
        7. Any issues or delays visible
        
        Format response as JSON with fields: progress_percentage, current_phase, quality_score, safety_issues, completion_estimate, recommendations, issues_detected.
        """
    
    def _create_quality_assessment_prompt(self, context: ImageContext, num_references: int) -> str:
        """Create prompt for quality assessment"""
        ref_text = f" Compare with the {num_references} reference images provided." if num_references > 0 else ""
        
        return f"""
        Assess the work quality in this {context.job_type} project image.{ref_text}
        
        Context:
        - Job Type: {context.job_type}
        - Location: {context.location}
        - Expected Outcome: {context.expected_outcome or 'Professional standard'}
        
        Evaluate:
        1. Overall quality score (1-10)
        2. Workmanship assessment
        3. Attention to detail
        4. Professional standards compliance
        5. Any defects or issues
        6. Areas for improvement
        7. Client satisfaction prediction
        
        Format as JSON with: quality_score, workmanship_rating, defects_found, improvement_areas, client_satisfaction_prediction, overall_assessment.
        """
    
    def _create_safety_inspection_prompt(self, context: ImageContext) -> str:
        """Create prompt for safety inspection"""
        return f"""
        Inspect this {context.job_type} job site image for safety compliance.
        
        Context:
        - Job Type: {context.job_type}
        - Location: {context.location}
        - Worker Present: {context.worker_id is not None}
        
        Check for:
        1. Personal protective equipment (PPE) usage
        2. Tool safety and proper handling
        3. Work area organization and cleanliness
        4. Hazard identification
        5. Safety protocol compliance
        6. Emergency access and exits
        7. Material storage safety
        
        Format as JSON with: safety_score, ppe_compliance, hazards_identified, safety_violations, recommendations, immediate_actions_needed.
        """
    
    def _create_material_identification_prompt(self, context: ImageContext) -> str:
        """Create prompt for material identification"""
        return f"""
        Identify materials and tools visible in this {context.job_type} job site image.
        
        Context:
        - Job Type: {context.job_type}
        - Location: {context.location}
        
        Identify:
        1. Construction materials present
        2. Tools and equipment visible
        3. Material quality assessment
        4. Appropriate materials for job type
        5. Missing materials or tools
        6. Material storage conditions
        7. Inventory suggestions
        
        Format as JSON with: materials_identified, tools_present, material_quality, missing_items, storage_assessment, inventory_recommendations.
        """
    
    def _create_comparison_prompt(self, context: ImageContext) -> str:
        """Create prompt for before/after comparison"""
        return f"""
        Compare these before and after images of a {context.job_type} project.
        
        Context:
        - Job Type: {context.job_type}
        - Location: {context.location}
        
        Analyze:
        1. Transformation quality and completeness
        2. Improvement areas achieved
        3. Professional execution assessment
        4. Client satisfaction prediction
        5. Value added to property
        6. Any remaining work needed
        7. Overall project success
        
        Format as JSON with: transformation_score, improvements_made, execution_quality, remaining_work, value_added, project_success_rating.
        """
    
    def _create_damage_assessment_prompt(self, context: ImageContext) -> str:
        """Create prompt for damage assessment"""
        return f"""
        Assess damage visible in this image for repair planning.
        
        Context:
        - Location: {context.location}
        - Assessment Type: {context.job_type}
        
        Evaluate:
        1. Type and extent of damage
        2. Severity level (minor, moderate, major, severe)
        3. Potential causes
        4. Repair complexity and requirements
        5. Estimated repair time and cost category
        6. Safety implications
        7. Priority level for repairs
        
        Format as JSON with: damage_type, severity_level, causes, repair_requirements, time_estimate, cost_category, safety_implications, priority_level.
        """
    
    # Result Processing Methods
    def _parse_vision_response(self, response_text: str) -> Dict[str, Any]:
        """Parse AI vision response"""
        try:
            # Try to extract JSON from response
            import re
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
            else:
                # Fallback parsing
                return {
                    'summary': response_text,
                    'confidence': 0.7,
                    'parsed': False
                }
        except Exception as e:
            logger.error(f"Error parsing vision response: {e}")
            return {'summary': response_text, 'confidence': 0.5, 'error': str(e)}
    
    def _combine_analysis_results(self, ai_analysis: Dict, cv_analysis: Dict, context: ImageContext) -> VisionAnalysisResult:
        """Combine AI and CV analysis results"""
        try:
            return VisionAnalysisResult(
                analysis_type=AnalysisType.JOB_PROGRESS,
                confidence=ai_analysis.get('confidence', 0.7),
                summary=ai_analysis.get('summary', 'Job progress analysis completed'),
                detailed_findings={
                    'ai_analysis': ai_analysis,
                    'cv_analysis': cv_analysis
                },
                quality_score=ai_analysis.get('quality_score', 0.8),
                safety_issues=ai_analysis.get('safety_issues', []),
                recommendations=ai_analysis.get('recommendations', []),
                objects_detected=cv_analysis.get('objects', []),
                progress_percentage=ai_analysis.get('progress_percentage'),
                estimated_completion_time=ai_analysis.get('completion_estimate'),
                requires_attention=len(ai_analysis.get('safety_issues', [])) > 0
            )
        except Exception as e:
            logger.error(f"Error combining analysis results: {e}")
            return self._create_fallback_analysis()
    
    def _combine_quality_results(self, ai_analysis: Dict, cv_analysis: Dict, context: ImageContext) -> VisionAnalysisResult:
        """Combine quality assessment results"""
        try:
            quality_score = ai_analysis.get('quality_score', 5) / 10.0  # Normalize to 0-1
            
            return VisionAnalysisResult(
                analysis_type=AnalysisType.QUALITY_ASSESSMENT,
                confidence=ai_analysis.get('confidence', 0.8),
                summary=ai_analysis.get('overall_assessment', 'Quality assessment completed'),
                detailed_findings={
                    'ai_analysis': ai_analysis,
                    'cv_analysis': cv_analysis
                },
                quality_score=quality_score,
                safety_issues=[],
                recommendations=ai_analysis.get('improvement_areas', []),
                objects_detected=cv_analysis.get('objects', []),
                requires_attention=quality_score < 0.7
            )
        except Exception as e:
            logger.error(f"Error combining quality results: {e}")
            return self._create_fallback_analysis()
    
    def _combine_safety_results(self, ai_analysis: Dict, cv_analysis: Dict, context: ImageContext) -> VisionAnalysisResult:
        """Combine safety inspection results"""
        try:
            safety_score = ai_analysis.get('safety_score', 8) / 10.0
            safety_issues = ai_analysis.get('hazards_identified', []) + ai_analysis.get('safety_violations', [])
            
            return VisionAnalysisResult(
                analysis_type=AnalysisType.SAFETY_INSPECTION,
                confidence=ai_analysis.get('confidence', 0.9),
                summary=f"Safety inspection completed. Score: {safety_score*100:.0f}%",
                detailed_findings={
                    'ai_analysis': ai_analysis,
                    'cv_analysis': cv_analysis
                },
                quality_score=safety_score,
                safety_issues=safety_issues,
                recommendations=ai_analysis.get('recommendations', []),
                objects_detected=cv_analysis.get('objects', []),
                requires_attention=safety_score < 0.8 or len(safety_issues) > 0
            )
        except Exception as e:
            logger.error(f"Error combining safety results: {e}")
            return self._create_fallback_analysis()
    
    def _combine_material_results(self, ai_analysis: Dict, cv_objects: List, context: ImageContext) -> VisionAnalysisResult:
        """Combine material identification results"""
        try:
            return VisionAnalysisResult(
                analysis_type=AnalysisType.MATERIAL_IDENTIFICATION,
                confidence=ai_analysis.get('confidence', 0.7),
                summary="Material and tool identification completed",
                detailed_findings={
                    'ai_analysis': ai_analysis,
                    'cv_objects': cv_objects
                },
                quality_score=ai_analysis.get('material_quality', 0.8),
                safety_issues=ai_analysis.get('storage_issues', []),
                recommendations=ai_analysis.get('inventory_recommendations', []),
                objects_detected=cv_objects,
                requires_attention=len(ai_analysis.get('missing_items', [])) > 0
            )
        except Exception as e:
            logger.error(f"Error combining material results: {e}")
            return self._create_fallback_analysis()
    
    def _combine_comparison_results(self, ai_analysis: Dict, cv_comparison: Dict, context: ImageContext) -> VisionAnalysisResult:
        """Combine before/after comparison results"""
        try:
            transformation_score = ai_analysis.get('transformation_score', 8) / 10.0
            
            return VisionAnalysisResult(
                analysis_type=AnalysisType.BEFORE_AFTER,
                confidence=ai_analysis.get('confidence', 0.8),
                summary=f"Before/after comparison completed. Transformation score: {transformation_score*100:.0f}%",
                detailed_findings={
                    'ai_analysis': ai_analysis,
                    'cv_comparison': cv_comparison
                },
                quality_score=transformation_score,
                safety_issues=[],
                recommendations=ai_analysis.get('remaining_work', []),
                objects_detected=[],
                requires_attention=len(ai_analysis.get('remaining_work', [])) > 0
            )
        except Exception as e:
            logger.error(f"Error combining comparison results: {e}")
            return self._create_fallback_analysis()
    
    def _combine_damage_results(self, ai_analysis: Dict, cv_damage: Dict, context: ImageContext) -> VisionAnalysisResult:
        """Combine damage assessment results"""
        try:
            severity_map = {'minor': 0.2, 'moderate': 0.5, 'major': 0.8, 'severe': 1.0}
            severity_score = severity_map.get(ai_analysis.get('severity_level', 'moderate'), 0.5)
            
            return VisionAnalysisResult(
                analysis_type=AnalysisType.DAMAGE_ASSESSMENT,
                confidence=ai_analysis.get('confidence', 0.8),
                summary=f"Damage assessment: {ai_analysis.get('damage_type', 'Unknown')} - {ai_analysis.get('severity_level', 'moderate')} severity",
                detailed_findings={
                    'ai_analysis': ai_analysis,
                    'cv_damage': cv_damage
                },
                quality_score=1.0 - severity_score,  # Inverse of damage severity
                safety_issues=ai_analysis.get('safety_implications', []),
                recommendations=ai_analysis.get('repair_requirements', []),
                objects_detected=[],
                requires_attention=severity_score > 0.5
            )
        except Exception as e:
            logger.error(f"Error combining damage results: {e}")
            return self._create_fallback_analysis()
    
    # Additional CV Methods (Stubs for advanced functionality)
    def _perform_quality_cv_analysis(self, image: np.ndarray, context: ImageContext) -> Dict[str, Any]:
        """Perform computer vision quality analysis"""
        # Placeholder for advanced quality analysis
        return {'cv_quality_score': 0.8, 'defects_detected': []}
    
    def _perform_safety_cv_analysis(self, image: np.ndarray, context: ImageContext) -> Dict[str, Any]:
        """Perform computer vision safety analysis"""
        # Placeholder for PPE detection, hazard identification
        return {'ppe_detected': True, 'hazards': []}
    
    def _perform_object_detection(self, image: np.ndarray) -> List[Dict[str, Any]]:
        """Perform advanced object detection"""
        # Placeholder for YOLO or similar object detection
        return self._detect_basic_objects(image)
    
    def _perform_cv_comparison(self, before: np.ndarray, after: np.ndarray) -> Dict[str, Any]:
        """Perform computer vision comparison"""
        # Placeholder for structural similarity and change detection
        return {'similarity_score': 0.3, 'changes_detected': True}
    
    def _perform_damage_detection(self, image: np.ndarray) -> Dict[str, Any]:
        """Perform computer vision damage detection"""
        # Placeholder for crack detection, surface analysis
        return {'damage_areas': [], 'damage_severity': 'moderate'}
    
    # Utility Methods
    def _create_fallback_analysis(self) -> VisionAnalysisResult:
        """Create fallback analysis when processing fails"""
        return VisionAnalysisResult(
            analysis_type=AnalysisType.JOB_PROGRESS,
            confidence=0.5,
            summary="Analysis completed with limited information",
            detailed_findings={},
            quality_score=0.7,
            safety_issues=[],
            recommendations=["Manual review recommended"],
            objects_detected=[],
            requires_attention=True
        )
    
    def _store_analysis(self, result: VisionAnalysisResult, context: ImageContext):
        """Store analysis result for learning and improvement"""
        try:
            analysis_record = {
                'timestamp': datetime.now(),
                'context': context,
                'result': result,
                'job_id': context.job_id
            }
            
            self.analysis_history.append(analysis_record)
            
            # Keep only recent analyses (last 1000)
            if len(self.analysis_history) > 1000:
                self.analysis_history = self.analysis_history[-1000:]
                
        except Exception as e:
            logger.error(f"Error storing analysis: {e}")
    
    def get_analysis_history(self, job_id: Optional[int] = None) -> List[Dict[str, Any]]:
        """Get analysis history, optionally filtered by job ID"""
        if job_id is None:
            return self.analysis_history
        else:
            return [record for record in self.analysis_history if record['context'].job_id == job_id]

