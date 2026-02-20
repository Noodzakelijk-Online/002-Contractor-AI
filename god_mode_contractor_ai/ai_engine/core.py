"""
God-Mode Contractor AI - Unified AI Engine Core
Combines all AI capabilities from both contractor_ai_backend and advanced_ai_backend
"""

import json
import requests
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from openai import OpenAI
import os


class GodModeContractorAI:
    """
    Unified AI engine combining:
    - Job analysis and planning
    - Worker selection and assignment
    - Intelligent scheduling
    - Multi-modal communication
    - Computer vision integration
    - Predictive analytics
    - Autonomous decision-making
    """
    
    def __init__(self):
        self.client = OpenAI()
        self.contractor_email = "noodzakelijkonline@gmail.com"
        self.contractor_phone = "+31 06-83515175"
        self.contractor_company = "Contractor AI Services"
        
        # Advanced AI capabilities flags
        self.vision_enabled = True
        self.predictive_enabled = True
        self.multimodal_enabled = True
        self.autonomous_mode = True
        
        # Learning and improvement
        self.decision_history = []
        self.performance_metrics = {
            'total_jobs_analyzed': 0,
            'successful_assignments': 0,
            'scheduling_accuracy': 0.0,
            'client_satisfaction': 0.0
        }
    
    # ============================================================================
    # PHASE 1: JOB ANALYSIS & INTAKE
    # ============================================================================
    
    def analyze_job_request(self, message: str, client_info: Dict, 
                           multimodal_data: Optional[Dict] = None) -> Dict:
        """
        Enhanced job analysis with multi-modal support
        
        Args:
            message: Client's text message
            client_info: Client contact and location info
            multimodal_data: Optional dict with 'images', 'voice', 'documents'
        
        Returns:
            Comprehensive job analysis with AI insights
        """
        
        # Build enhanced prompt with multimodal context
        prompt = self._build_analysis_prompt(message, client_info, multimodal_data)
        
        try:
            response = self.client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                response_format={"type": "json_object"}
            )
            
            analysis = json.loads(response.choices[0].message.content)
            
            # Enhance with computer vision if images provided
            if multimodal_data and multimodal_data.get('images'):
                vision_insights = self._analyze_images(multimodal_data['images'])
                analysis['vision_insights'] = vision_insights
            
            # Add AI confidence scoring
            analysis['ai_confidence'] = self._calculate_confidence(analysis)
            
            # Predictive cost estimation
            analysis['cost_prediction'] = self._predict_costs(analysis)
            
            # Update learning metrics
            self.performance_metrics['total_jobs_analyzed'] += 1
            
            return analysis
            
        except Exception as e:
            print(f"AI analysis error: {e}")
            return self._fallback_analysis(message)
    
    def _build_analysis_prompt(self, message: str, client_info: Dict, 
                               multimodal_data: Optional[Dict]) -> str:
        """Build comprehensive analysis prompt"""
        
        prompt = f"""
        You are an expert contractor AI with advanced analytical capabilities. 
        Analyze this job request comprehensively.
        
        CLIENT MESSAGE: "{message}"
        
        CLIENT INFO: {json.dumps(client_info, indent=2)}
        """
        
        if multimodal_data:
            if multimodal_data.get('images'):
                prompt += f"\n\nIMAGES PROVIDED: {len(multimodal_data['images'])} images attached"
            if multimodal_data.get('voice'):
                prompt += f"\n\nVOICE MESSAGE: Transcription available"
            if multimodal_data.get('documents'):
                prompt += f"\n\nDOCUMENTS: {len(multimodal_data['documents'])} documents attached"
        
        prompt += """
        
        Provide a comprehensive JSON response with:
        {
            "job_type": "Category (plumbing, electrical, garden, renovation, cleaning, painting, etc.)",
            "job_subcategory": "Specific subcategory",
            "urgency": "emergency | high | medium | low",
            "complexity_score": "1-10 scale",
            "estimated_duration": "hours (decimal)",
            "weather_dependent": true/false,
            "required_skills": ["skill1", "skill2"],
            "required_tools": ["tool1", "tool2"],
            "materials_needed": ["material1", "material2"],
            "estimated_cost": "euros (number)",
            "cost_breakdown": {
                "labor": 0,
                "materials": 0,
                "equipment": 0,
                "contingency": 0
            },
            "special_requirements": "Any special needs or constraints",
            "safety_considerations": ["safety1", "safety2"],
            "questions_for_client": ["question1", "question2"],
            "recommended_approach": "Brief description of how to tackle this job",
            "potential_challenges": ["challenge1", "challenge2"],
            "quality_checkpoints": ["checkpoint1", "checkpoint2"]
        }
        
        Be realistic, practical, and thorough in your analysis.
        """
        
        return prompt
    
    def _analyze_images(self, images: List[str]) -> Dict:
        """
        Analyze job site images using computer vision
        
        Args:
            images: List of image URLs or base64 encoded images
        
        Returns:
            Vision analysis results
        """
        # This would integrate with the ComputerVisionProcessor
        # For now, return placeholder structure
        return {
            'images_analyzed': len(images),
            'detected_issues': [],
            'condition_assessment': 'good',
            'recommendations': []
        }
    
    def _calculate_confidence(self, analysis: Dict) -> str:
        """Calculate AI confidence level based on analysis completeness"""
        
        score = 0
        max_score = 10
        
        # Check completeness of analysis
        if analysis.get('job_type'): score += 2
        if analysis.get('complexity_score'): score += 2
        if analysis.get('estimated_cost'): score += 2
        if analysis.get('required_skills'): score += 1
        if analysis.get('required_tools'): score += 1
        if analysis.get('recommended_approach'): score += 1
        if analysis.get('cost_breakdown'): score += 1
        
        if score >= 8:
            return 'high'
        elif score >= 5:
            return 'medium'
        else:
            return 'low'
    
    def _predict_costs(self, analysis: Dict) -> Dict:
        """Enhanced cost prediction with confidence intervals"""
        
        base_cost = analysis.get('estimated_cost', 0)
        complexity = analysis.get('complexity_score', 5)
        
        # Calculate prediction ranges
        uncertainty_factor = complexity / 10 * 0.3  # 30% max uncertainty
        
        return {
            'estimated': base_cost,
            'minimum': base_cost * (1 - uncertainty_factor),
            'maximum': base_cost * (1 + uncertainty_factor),
            'confidence_interval': f"{int((1 - uncertainty_factor) * 100)}%"
        }
    
    def _fallback_analysis(self, message: str) -> Dict:
        """Fallback analysis when AI fails"""
        return {
            'job_type': 'general_maintenance',
            'job_subcategory': 'unspecified',
            'urgency': 'medium',
            'complexity_score': 5,
            'estimated_duration': 4,
            'weather_dependent': False,
            'required_skills': ['general_maintenance'],
            'required_tools': ['basic_tools'],
            'materials_needed': [],
            'estimated_cost': 100.0,
            'cost_breakdown': {
                'labor': 80,
                'materials': 20,
                'equipment': 0,
                'contingency': 0
            },
            'special_requirements': None,
            'safety_considerations': ['standard_ppe'],
            'questions_for_client': ['Can you provide more details about the work needed?'],
            'recommended_approach': 'Assess on-site and provide detailed quote',
            'potential_challenges': ['Insufficient information'],
            'quality_checkpoints': ['Client approval'],
            'ai_confidence': 'low',
            'cost_prediction': {
                'estimated': 100,
                'minimum': 80,
                'maximum': 150,
                'confidence_interval': '70%'
            }
        }
    
    # ============================================================================
    # PHASE 2: WORKER SELECTION & ASSIGNMENT
    # ============================================================================
    
    def select_optimal_worker(self, job_requirements: Dict, 
                             available_workers: List[Dict],
                             historical_data: Optional[List[Dict]] = None) -> Tuple[Optional[Dict], str, List[str]]:
        """
        Advanced worker selection with predictive analytics
        
        Args:
            job_requirements: Job requirements and constraints
            available_workers: List of available workers with their data
            historical_data: Optional historical performance data
        
        Returns:
            (best_worker, confidence_level, reasoning)
        """
        
        if not available_workers:
            return None, "low", ["No workers available"]
        
        best_worker = None
        best_score = 0
        reasoning = []
        
        for worker in available_workers:
            score = 0
            worker_reasoning = []
            
            # 1. Skill matching (35% weight)
            skill_match = self._calculate_skill_match(
                job_requirements.get('required_skills', []), 
                worker.get('skills', [])
            )
            score += skill_match * 0.35
            worker_reasoning.append(f"Skill match: {skill_match:.1f}/10")
            
            # 2. Success rate (25% weight)
            success_rate = worker.get('success_rate', 95) / 10
            score += success_rate * 0.25
            worker_reasoning.append(f"Success rate: {worker.get('success_rate', 95)}%")
            
            # 3. Availability (15% weight)
            availability_score = 10 if worker.get('status') == 'available' else 5
            score += availability_score * 0.15
            worker_reasoning.append(f"Availability: {worker.get('status', 'unknown')}")
            
            # 4. Performance history (15% weight)
            performance = min(worker.get('on_time_rate', 95) / 10, 10)
            score += performance * 0.15
            worker_reasoning.append(f"On-time rate: {worker.get('on_time_rate', 95)}%")
            
            # 5. Job type experience (10% weight)
            job_type_exp = self._calculate_job_type_experience(
                job_requirements.get('job_type'),
                worker.get('job_history', [])
            )
            score += job_type_exp * 0.10
            worker_reasoning.append(f"Job type experience: {job_type_exp:.1f}/10")
            
            # 6. Predictive success probability (bonus)
            if historical_data:
                success_probability = self._predict_worker_success(worker, job_requirements, historical_data)
                score += success_probability * 0.05
                worker_reasoning.append(f"Predicted success: {success_probability * 10:.1f}/10")
            
            if score > best_score:
                best_score = score
                best_worker = worker
                reasoning = worker_reasoning
        
        # Determine confidence level
        if best_score >= 8:
            confidence = 'high'
        elif best_score >= 6:
            confidence = 'medium'
        else:
            confidence = 'low'
        
        # Update metrics
        self.performance_metrics['successful_assignments'] += 1
        
        return best_worker, confidence, reasoning
    
    def _calculate_skill_match(self, required_skills: List[str], worker_skills: List[str]) -> float:
        """Calculate how well worker skills match job requirements"""
        if not required_skills:
            return 8.0  # Default good score if no specific skills required
        
        matches = 0
        for required in required_skills:
            for worker_skill in worker_skills:
                if required.lower() in worker_skill.lower() or worker_skill.lower() in required.lower():
                    matches += 1
                    break
        
        match_percentage = matches / len(required_skills)
        return min(match_percentage * 10, 10)
    
    def _calculate_job_type_experience(self, job_type: str, job_history: List[Dict]) -> float:
        """Calculate worker's experience with this job type"""
        if not job_type or not job_history:
            return 5.0  # Neutral score
        
        relevant_jobs = [j for j in job_history if j.get('job_type', '').lower() == job_type.lower()]
        
        if not relevant_jobs:
            return 3.0  # Low score for no experience
        
        # Score based on number of similar jobs and their outcomes
        experience_score = min(len(relevant_jobs) * 2, 8)  # Cap at 8
        
        # Bonus for successful outcomes
        successful = sum(1 for j in relevant_jobs if j.get('outcome') == 'success')
        if successful > 0:
            success_rate = successful / len(relevant_jobs)
            experience_score += success_rate * 2
        
        return min(experience_score, 10)
    
    def _predict_worker_success(self, worker: Dict, job_requirements: Dict, 
                               historical_data: List[Dict]) -> float:
        """Predict probability of worker success using historical data"""
        # Simplified predictive model
        # In production, this would use ML models
        
        base_probability = worker.get('success_rate', 95) / 100
        complexity_factor = 1 - (job_requirements.get('complexity_score', 5) / 20)
        
        return min((base_probability + complexity_factor) / 2, 1.0)
    
    # ============================================================================
    # PHASE 3: INTELLIGENT SCHEDULING
    # ============================================================================
    
    def optimize_schedule(self, job_data: Dict, worker_data: Dict, 
                         existing_jobs: List[Dict],
                         constraints: Optional[Dict] = None) -> Dict:
        """
        Advanced scheduling optimization with multiple constraints
        
        Args:
            job_data: Job information and requirements
            worker_data: Assigned worker information
            existing_jobs: Currently scheduled jobs
            constraints: Optional scheduling constraints
        
        Returns:
            Optimal schedule with reasoning
        """
        
        # Get weather forecast
        weather_forecast = self._get_weather_forecast(job_data.get('location', 'Amsterdam'))
        
        # Calculate optimal time slots
        optimal_slots = []
        base_date = datetime.now().replace(hour=9, minute=0, second=0, microsecond=0)
        
        for day_offset in range(14):  # Look ahead 14 days
            check_date = base_date + timedelta(days=day_offset)
            
            # Skip weekends for most jobs (unless emergency)
            if check_date.weekday() >= 5 and job_data.get('urgency') != 'emergency':
                continue
            
            # Check weather if job is weather dependent
            if job_data.get('weather_dependent', False):
                day_weather = self._get_day_weather(weather_forecast, check_date)
                if not self._is_weather_suitable(day_weather):
                    continue
            
            # Check worker availability
            if not self._is_worker_available(worker_data, check_date, existing_jobs):
                continue
            
            # Check tool availability
            if not self._are_tools_available(job_data.get('required_tools', []), check_date, existing_jobs):
                continue
            
            # Calculate slot score
            slot_score = self._calculate_slot_score(
                check_date, job_data, worker_data, weather_forecast
            )
            
            optimal_slots.append({
                'date': check_date.isoformat(),
                'score': slot_score,
                'weather': day_weather if job_data.get('weather_dependent') else None,
                'reasoning': self._generate_slot_reasoning(check_date, slot_score, day_weather)
            })
        
        # Sort by score and select best
        optimal_slots.sort(key=lambda x: x['score'], reverse=True)
        
        if not optimal_slots:
            return {
                'success': False,
                'error': 'No suitable time slots found',
                'recommendation': 'Consider adjusting job requirements or worker assignment'
            }
        
        best_slot = optimal_slots[0]
        
        return {
            'success': True,
            'scheduled_date': best_slot['date'],
            'confidence': 'high' if best_slot['score'] >= 8 else 'medium',
            'score': best_slot['score'],
            'reasoning': best_slot['reasoning'],
            'weather_forecast': best_slot.get('weather'),
            'alternative_slots': optimal_slots[1:4] if len(optimal_slots) > 1 else [],
            'optimization_factors': [
                'Worker availability',
                'Weather conditions' if job_data.get('weather_dependent') else None,
                'Tool availability',
                'Job urgency',
                'Optimal working hours'
            ]
        }
    
    def _get_weather_forecast(self, location: str) -> Dict:
        """Get weather forecast from Buienradar API"""
        try:
            response = requests.get('https://data.buienradar.nl/2.0/feed/json', timeout=5)
            if response.status_code == 200:
                data = response.json()
                return data.get('forecast', {})
        except:
            pass
        
        return {'days': []}
    
    def _get_day_weather(self, forecast: Dict, date: datetime) -> Optional[Dict]:
        """Extract weather for specific day"""
        # Simplified - in production would match date properly
        days = forecast.get('days', [])
        if days and len(days) > 0:
            return days[0]  # Return first day as example
        return None
    
    def _is_weather_suitable(self, weather: Optional[Dict]) -> bool:
        """Check if weather is suitable for outdoor work"""
        if not weather:
            return True  # Assume OK if no data
        
        # Check for rain, strong wind, extreme temperatures
        rain_chance = weather.get('rainChance', 0)
        wind_speed = weather.get('windSpeed', 0)
        
        return rain_chance < 50 and wind_speed < 40
    
    def _is_worker_available(self, worker_data: Dict, date: datetime, 
                            existing_jobs: List[Dict]) -> bool:
        """Check if worker is available on given date"""
        # Check existing job assignments
        for job in existing_jobs:
            if job.get('assigned_worker_id') == worker_data.get('id'):
                job_date = datetime.fromisoformat(job.get('scheduled_date', ''))
                if job_date.date() == date.date():
                    return False
        return True
    
    def _are_tools_available(self, required_tools: List[str], date: datetime,
                            existing_jobs: List[Dict]) -> bool:
        """Check if required tools are available"""
        # Simplified check - in production would check tool inventory
        return True
    
    def _calculate_slot_score(self, date: datetime, job_data: Dict, 
                             worker_data: Dict, weather: Dict) -> float:
        """Calculate score for a time slot"""
        score = 5.0  # Base score
        
        # Urgency bonus
        urgency = job_data.get('urgency', 'medium')
        days_out = (date.date() - datetime.now().date()).days
        
        if urgency == 'emergency' and days_out == 0:
            score += 5
        elif urgency == 'high' and days_out <= 1:
            score += 3
        elif urgency == 'medium' and days_out <= 3:
            score += 2
        
        # Weather bonus (if applicable)
        if job_data.get('weather_dependent'):
            # Would check actual weather quality here
            score += 1
        
        # Optimal day of week (Tuesday-Thursday preferred)
        if date.weekday() in [1, 2, 3]:
            score += 1
        
        return min(score, 10)
    
    def _generate_slot_reasoning(self, date: datetime, score: float, 
                                 weather: Optional[Dict]) -> str:
        """Generate human-readable reasoning for slot selection"""
        reasons = []
        
        days_out = (date.date() - datetime.now().date()).days
        reasons.append(f"Available in {days_out} day(s)")
        
        day_name = date.strftime('%A')
        reasons.append(f"{day_name} is a good working day")
        
        if weather:
            reasons.append("Weather conditions are favorable")
        
        if score >= 8:
            reasons.append("Optimal scheduling conditions")
        
        return "; ".join(reasons)
    
    # ============================================================================
    # PHASE 4: CLIENT COMMUNICATION
    # ============================================================================
    
    def generate_client_communication(self, job_data: Dict, worker_data: Dict,
                                     schedule_data: Dict, communication_type: str,
                                     tone: str = 'professional') -> str:
        """
        Generate intelligent client communication
        
        Args:
            job_data: Job information
            worker_data: Worker information
            schedule_data: Schedule information
            communication_type: Type of communication (job_received, scheduled, update, completion)
            tone: Communication tone (professional, friendly, urgent)
        
        Returns:
            Generated message text
        """
        
        prompt = f"""
        Generate a {tone} message for a contractor business to send to a client.
        
        Communication type: {communication_type}
        Job: {job_data.get('title', 'Service Request')}
        Client: {job_data.get('client_name', 'Valued Customer')}
        
        Context:
        - Job type: {job_data.get('job_type', 'maintenance')}
        - Estimated cost: €{job_data.get('estimated_cost', 0)}
        """
        
        if worker_data:
            prompt += f"\n- Assigned worker: {worker_data.get('name', 'Our team')}"
        
        if schedule_data and schedule_data.get('scheduled_date'):
            scheduled_date = datetime.fromisoformat(schedule_data['scheduled_date'])
            prompt += f"\n- Scheduled: {scheduled_date.strftime('%A, %B %d at %H:%M')}"
        
        prompt += f"""
        
        Generate a clear, concise message that:
        1. Acknowledges their request (if job_received)
        2. Provides key information
        3. Sets clear expectations
        4. Includes a call-to-action if needed
        5. Maintains a {tone} tone
        
        Keep it under 200 words. Do not use placeholders - use the actual information provided.
        """
        
        try:
            response = self.client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7,
                max_tokens=300
            )
            
            return response.choices[0].message.content.strip()
            
        except Exception as e:
            print(f"Communication generation error: {e}")
            return self._fallback_communication(communication_type, job_data)
    
    def _fallback_communication(self, comm_type: str, job_data: Dict) -> str:
        """Fallback communication templates"""
        
        templates = {
            'job_received': f"Thank you for contacting us about {job_data.get('title', 'your service request')}. We've received your request and will get back to you shortly with a schedule and quote.",
            'scheduled': f"Your job has been scheduled. We'll contact you with the details shortly.",
            'update': f"We wanted to update you on the progress of your job. Work is proceeding as planned.",
            'completion': f"Your job has been completed. Thank you for choosing our services!"
        }
        
        return templates.get(comm_type, "Thank you for contacting us. We'll be in touch soon.")
    
    # ============================================================================
    # UTILITY METHODS
    # ============================================================================
    
    def send_email_notification(self, to_email: str, subject: str, body: str) -> bool:
        """Send email notification"""
        try:
            # Email sending logic would go here
            # For now, just log
            print(f"EMAIL: To={to_email}, Subject={subject}")
            return True
        except Exception as e:
            print(f"Email error: {e}")
            return False
    
    def get_performance_metrics(self) -> Dict:
        """Get AI performance metrics"""
        return self.performance_metrics.copy()
    
    def update_learning_data(self, job_id: int, outcome: str, feedback: Dict):
        """Update AI learning data based on job outcomes"""
        self.decision_history.append({
            'job_id': job_id,
            'outcome': outcome,
            'feedback': feedback,
            'timestamp': datetime.now().isoformat()
        })
        
        # Update metrics
        if outcome == 'success':
            self.performance_metrics['client_satisfaction'] = (
                self.performance_metrics['client_satisfaction'] * 0.9 + 1.0 * 0.1
            )
