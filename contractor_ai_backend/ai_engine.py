import json
import requests
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from openai import OpenAI
import os

class ContractorAI:
    def __init__(self):
        self.client = OpenAI()
        self.contractor_email = "noodzakelijkonline@gmail.com"
        self.contractor_phone = "+31 06-83515175"
        
    def analyze_job_request(self, message: str, client_info: Dict) -> Dict:
        """Phase 1: Analyze incoming job request and extract requirements"""
        
        prompt = f"""
        You are an experienced contractor AI analyzing a job request. Extract and analyze the following:
        
        Client message: "{message}"
        Client info: {json.dumps(client_info)}
        
        Provide a JSON response with:
        1. job_type: Category of work (plumbing, electrical, garden, renovation, cleaning, etc.)
        2. urgency: emergency, high, medium, low
        3. complexity_score: 1-10 scale
        4. estimated_duration: hours
        5. weather_dependent: true/false
        6. required_skills: list of skills needed
        7. required_tools: list of tools needed
        8. estimated_cost: rough estimate in euros
        9. special_requirements: any special needs
        10. questions_for_client: clarifying questions to ask
        
        Be realistic and practical in your analysis.
        """
        
        try:
            response = self.client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3
            )
            
            analysis = json.loads(response.choices[0].message.content)
            analysis['ai_confidence'] = 'high' if analysis.get('complexity_score', 5) <= 7 else 'medium'
            
            return analysis
            
        except Exception as e:
            print(f"AI analysis error: {e}")
            return self._fallback_analysis(message)
    
    def _fallback_analysis(self, message: str) -> Dict:
        """Fallback analysis when AI fails"""
        return {
            'job_type': 'general_maintenance',
            'urgency': 'medium',
            'complexity_score': 5,
            'estimated_duration': 4,
            'weather_dependent': False,
            'required_skills': ['general_maintenance'],
            'required_tools': ['basic_tools'],
            'estimated_cost': 100.0,
            'special_requirements': None,
            'questions_for_client': ['Can you provide more details about the work needed?'],
            'ai_confidence': 'low'
        }
    
    def select_optimal_worker(self, job_requirements: Dict, available_workers: List[Dict]) -> Tuple[Optional[Dict], str, List[str]]:
        """Phase 2: Select the best worker for the job"""
        
        if not available_workers:
            return None, "No workers available", []
        
        best_worker = None
        best_score = 0
        reasoning = []
        
        for worker in available_workers:
            score = 0
            worker_reasoning = []
            
            # Skill matching (40% weight)
            skill_match = self._calculate_skill_match(job_requirements.get('required_skills', []), 
                                                    worker.get('skills', []))
            score += skill_match * 0.4
            worker_reasoning.append(f"Skill match: {skill_match:.1f}/10")
            
            # Success rate (30% weight)
            success_rate = worker.get('success_rate', 95) / 10  # Convert to 0-10 scale
            score += success_rate * 0.3
            worker_reasoning.append(f"Success rate: {worker.get('success_rate', 95)}%")
            
            # Availability (20% weight)
            availability_score = 10 if worker.get('status') == 'available' else 5
            score += availability_score * 0.2
            worker_reasoning.append(f"Availability: {worker.get('status', 'unknown')}")
            
            # Performance history (10% weight)
            performance = min(worker.get('on_time_rate', 95) / 10, 10)
            score += performance * 0.1
            worker_reasoning.append(f"On-time rate: {worker.get('on_time_rate', 95)}%")
            
            if score > best_score:
                best_score = score
                best_worker = worker
                reasoning = worker_reasoning
        
        confidence = 'high' if best_score >= 8 else 'medium' if best_score >= 6 else 'low'
        
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
        return min(match_percentage * 10, 10)  # Scale to 0-10
    
    def optimize_schedule(self, job_data: Dict, worker_data: Dict, existing_jobs: List[Dict]) -> Dict:
        """Phase 3: Optimize scheduling considering all constraints"""
        
        # Get weather data
        weather_forecast = self._get_weather_forecast(job_data.get('location', 'Amsterdam'))
        
        # Calculate optimal time slots
        optimal_slots = []
        base_date = datetime.now().replace(hour=9, minute=0, second=0, microsecond=0)
        
        for day_offset in range(7):  # Look ahead 7 days
            check_date = base_date + timedelta(days=day_offset)
            
            # Skip weekends for most jobs (unless emergency)
            if check_date.weekday() >= 5 and job_data.get('urgency') != 'emergency':
                continue
            
            # Check weather if job is weather dependent
            if job_data.get('weather_dependent', False):
                day_weather = weather_forecast.get(check_date.strftime('%Y-%m-%d'), {})
                if day_weather.get('rain_probability', 0) > 50:
                    continue
            
            # Find available time slots
            for hour in range(9, 17):  # 9 AM to 5 PM
                slot_start = check_date.replace(hour=hour)
                slot_end = slot_start + timedelta(hours=job_data.get('estimated_duration', 4))
                
                # Check if worker is available
                if self._is_worker_available(worker_data, slot_start, slot_end, existing_jobs):
                    optimal_slots.append({
                        'start': slot_start,
                        'end': slot_end,
                        'weather_score': self._calculate_weather_score(day_weather, job_data),
                        'efficiency_score': self._calculate_efficiency_score(slot_start, worker_data)
                    })
        
        if not optimal_slots:
            return {
                'recommended_slot': None,
                'confidence': 'low',
                'reasoning': 'No suitable time slots found in the next 7 days',
                'alternatives': []
            }
        
        # Sort by combined score
        optimal_slots.sort(key=lambda x: x['weather_score'] + x['efficiency_score'], reverse=True)
        best_slot = optimal_slots[0]
        
        return {
            'recommended_slot': {
                'start': best_slot['start'].isoformat(),
                'end': best_slot['end'].isoformat()
            },
            'confidence': 'high' if len(optimal_slots) >= 3 else 'medium',
            'reasoning': f"Optimal slot found with weather score {best_slot['weather_score']:.1f} and efficiency score {best_slot['efficiency_score']:.1f}",
            'alternatives': [
                {
                    'start': slot['start'].isoformat(),
                    'end': slot['end'].isoformat()
                } for slot in optimal_slots[1:4]  # Next 3 best options
            ]
        }
    
    def _get_weather_forecast(self, location: str) -> Dict:
        """Get weather forecast from Buienradar API"""
        try:
            # Simplified weather data - in production, integrate with actual Buienradar API
            base_date = datetime.now().date()
            forecast = {}
            
            for i in range(7):
                date_key = (base_date + timedelta(days=i)).strftime('%Y-%m-%d')
                forecast[date_key] = {
                    'temperature': 12 + (i % 3),  # Simulated temperature
                    'rain_probability': 20 + (i * 10) % 60,  # Simulated rain chance
                    'wind_speed': 15 + (i % 5),
                    'conditions': 'partly_cloudy'
                }
            
            return forecast
            
        except Exception as e:
            print(f"Weather API error: {e}")
            return {}
    
    def _is_worker_available(self, worker: Dict, start_time: datetime, end_time: datetime, existing_jobs: List[Dict]) -> bool:
        """Check if worker is available during the specified time slot"""
        
        # Check worker's general availability
        if worker.get('status') != 'available':
            return False
        
        # Check against existing scheduled jobs
        for job in existing_jobs:
            if job.get('assigned_worker_id') == worker.get('id'):
                job_start = datetime.fromisoformat(job.get('scheduled_start', ''))
                job_end = datetime.fromisoformat(job.get('scheduled_end', ''))
                
                # Check for overlap
                if not (end_time <= job_start or start_time >= job_end):
                    return False
        
        return True
    
    def _calculate_weather_score(self, weather: Dict, job_data: Dict) -> float:
        """Calculate weather suitability score"""
        if not job_data.get('weather_dependent', False):
            return 10.0  # Weather doesn't matter
        
        if not weather:
            return 5.0  # No weather data, neutral score
        
        score = 10.0
        
        # Penalize for rain
        rain_prob = weather.get('rain_probability', 0)
        score -= (rain_prob / 100) * 8  # Max 8 point penalty
        
        # Penalize for extreme temperatures
        temp = weather.get('temperature', 15)
        if temp < 5 or temp > 30:
            score -= 2
        
        # Penalize for high wind
        wind = weather.get('wind_speed', 10)
        if wind > 25:
            score -= 3
        
        return max(score, 0)
    
    def _calculate_efficiency_score(self, slot_start: datetime, worker: Dict) -> float:
        """Calculate efficiency score based on time of day and worker preferences"""
        hour = slot_start.hour
        
        # Most workers are most efficient in the morning
        if 9 <= hour <= 11:
            return 10.0
        elif 12 <= hour <= 14:
            return 8.0
        elif 15 <= hour <= 16:
            return 6.0
        else:
            return 4.0
    
    def generate_client_communication(self, job_data: Dict, worker_data: Dict, schedule_data: Dict, communication_type: str) -> str:
        """Generate appropriate client communication"""
        
        templates = {
            'job_received': f"""
Hi {job_data.get('client_name', 'there')}! 👋

I've received your request for {job_data.get('job_type', 'maintenance work')} at {job_data.get('location', 'your location')}.

✅ Job analyzed and categorized
🤖 AI is finding the best worker for you
📅 Scheduling in progress

I'll update you shortly with the plan and timeline.

Best regards,
Manus AI Contractor Assistant
            """.strip(),
            
            'worker_assigned': f"""
Great news! 🎉

✅ {worker_data.get('name', 'Worker')} has been assigned to your job
📅 Scheduled for {datetime.fromisoformat(schedule_data['recommended_slot']['start']).strftime('%A, %B %d at %I:%M %p')}
⭐ Success rate: {worker_data.get('success_rate', 95)}%
🛠️ Specialist in: {', '.join(worker_data.get('skills', [])[:3])}

{worker_data.get('name', 'Your worker')} will contact you 30 minutes before arrival.

Questions? Just reply to this message!
            """.strip(),
            
            'job_started': f"""
🚀 Work has started!

{worker_data.get('name', 'Your worker')} has arrived and begun work at {job_data.get('location', 'your location')}.

I'll send you progress updates throughout the day.

Track progress: [link to your private job portal]
            """.strip(),
            
            'job_completed': f"""
✅ Job completed successfully!

{worker_data.get('name', 'Your worker')} has finished the work. Here's the summary:

📊 Progress: 100% complete
⏱️ Time taken: {job_data.get('actual_duration', 'as estimated')}
💰 Total cost: €{job_data.get('actual_cost', job_data.get('estimated_cost', 0))}

Photos and final invoice: [link]

Thank you for choosing our service! 🙏
            """.strip()
        }
        
        return templates.get(communication_type, "Update on your job request.")
    
    def send_email_notification(self, to_email: str, subject: str, message: str) -> bool:
        """Send email notification"""
        try:
            # In production, use proper SMTP configuration
            print(f"EMAIL TO: {to_email}")
            print(f"SUBJECT: {subject}")
            print(f"MESSAGE: {message}")
            print("=" * 50)
            
            # Simulate sending to contractor
            if to_email == self.contractor_email:
                print(f"📧 CONTRACTOR NOTIFICATION SENT TO: {self.contractor_email}")
                return True
            
            return True
            
        except Exception as e:
            print(f"Email sending error: {e}")
            return False
    
    def send_sms_notification(self, to_phone: str, message: str) -> bool:
        """Send SMS notification"""
        try:
            # In production, integrate with SMS service like Twilio
            print(f"SMS TO: {to_phone}")
            print(f"MESSAGE: {message}")
            print("=" * 50)
            
            # Simulate sending to contractor
            if to_phone == self.contractor_phone:
                print(f"📱 CONTRACTOR SMS SENT TO: {self.contractor_phone}")
                return True
            
            return True
            
        except Exception as e:
            print(f"SMS sending error: {e}")
            return False
    
    def make_autonomous_decision(self, decision_type: str, context: Dict) -> Dict:
        """Make autonomous decisions based on context"""
        
        if decision_type == "emergency_response":
            return self._handle_emergency(context)
        elif decision_type == "schedule_conflict":
            return self._resolve_schedule_conflict(context)
        elif decision_type == "scope_change":
            return self._handle_scope_change(context)
        elif decision_type == "quality_issue":
            return self._handle_quality_issue(context)
        elif decision_type == "weather_delay":
            return self._handle_weather_delay(context)
        else:
            return {"action": "escalate_to_human", "reason": "Unknown decision type"}
    
    def _handle_emergency(self, context: Dict) -> Dict:
        """Handle emergency situations"""
        emergency_level = context.get('emergency_level', 'medium')
        
        if emergency_level == 'critical':
            # Immediate contractor notification + emergency worker dispatch
            self.send_email_notification(
                self.contractor_email,
                "🚨 CRITICAL EMERGENCY - Immediate Action Required",
                f"Critical emergency at {context.get('location', 'unknown location')}. "
                f"Issue: {context.get('description', 'No details provided')}. "
                f"Client: {context.get('client_name', 'Unknown')} - {context.get('client_phone', 'No phone')}"
            )
            
            self.send_sms_notification(
                self.contractor_phone,
                f"🚨 CRITICAL: {context.get('description', 'Emergency')} at {context.get('location', 'unknown')}. "
                f"Client: {context.get('client_phone', 'No phone')}. CHECK EMAIL NOW."
            )
            
            return {
                "action": "emergency_dispatch",
                "confidence": "high",
                "notifications_sent": True,
                "next_steps": ["contractor_notified", "emergency_worker_dispatched", "client_safety_check"]
            }
        
        return {"action": "escalate_to_human", "reason": "Emergency requires human judgment"}
    
    def _resolve_schedule_conflict(self, context: Dict) -> Dict:
        """Resolve scheduling conflicts automatically"""
        conflict_type = context.get('conflict_type', 'overlap')
        
        if conflict_type == 'tool_conflict':
            # Find alternative tools or reschedule
            return {
                "action": "reschedule_job",
                "new_schedule": self._find_alternative_schedule(context),
                "reason": "Tool conflict resolved by rescheduling",
                "confidence": "medium"
            }
        
        return {"action": "escalate_to_human", "reason": "Complex scheduling conflict"}
    
    def _handle_scope_change(self, context: Dict) -> Dict:
        """Handle scope changes during job execution"""
        cost_impact = context.get('cost_impact', 0)
        
        if cost_impact <= 50:  # Auto-approve small changes
            return {
                "action": "auto_approve",
                "reason": "Small scope change within acceptable limits",
                "confidence": "high",
                "notify_client": True
            }
        elif cost_impact <= 200:  # Require client approval
            return {
                "action": "request_client_approval",
                "reason": "Moderate scope change requires client consent",
                "confidence": "medium"
            }
        else:  # Escalate large changes
            return {
                "action": "escalate_to_human",
                "reason": "Large scope change requires contractor review"
            }
    
    def _handle_quality_issue(self, context: Dict) -> Dict:
        """Handle quality issues detected during work"""
        severity = context.get('severity', 'medium')
        
        if severity == 'low':
            return {
                "action": "worker_guidance",
                "guidance": "Please review the work and ensure it meets our quality standards",
                "confidence": "high"
            }
        else:
            return {
                "action": "escalate_to_human",
                "reason": "Quality issue requires contractor intervention"
            }
    
    def _handle_weather_delay(self, context: Dict) -> Dict:
        """Handle weather-related delays"""
        delay_duration = context.get('delay_hours', 2)
        
        if delay_duration <= 4:  # Short delay - reschedule automatically
            new_schedule = self._find_next_weather_window(context)
            return {
                "action": "auto_reschedule",
                "new_schedule": new_schedule,
                "reason": "Weather delay - automatically rescheduled",
                "confidence": "high",
                "notify_client": True
            }
        
        return {"action": "escalate_to_human", "reason": "Extended weather delay requires review"}
    
    def _find_alternative_schedule(self, context: Dict) -> Dict:
        """Find alternative scheduling options"""
        # Simplified implementation
        current_time = datetime.now()
        alternative = current_time + timedelta(days=1, hours=2)
        
        return {
            "start": alternative.isoformat(),
            "end": (alternative + timedelta(hours=4)).isoformat()
        }
    
    def _find_next_weather_window(self, context: Dict) -> Dict:
        """Find next suitable weather window"""
        # Simplified implementation
        current_time = datetime.now()
        next_window = current_time + timedelta(hours=6)
        
        return {
            "start": next_window.isoformat(),
            "end": (next_window + timedelta(hours=4)).isoformat()
        }
    
    def calculate_dynamic_pricing(self, job_data: Dict, market_conditions: Dict) -> Dict:
        """Calculate dynamic pricing based on multiple factors"""
        
        base_rate = 20.0  # Base hourly rate
        equipment_rate = 2.50  # Equipment surcharge
        
        # Factors affecting pricing
        urgency_multiplier = {
            'emergency': 1.5,
            'high': 1.2,
            'medium': 1.0,
            'low': 0.9
        }.get(job_data.get('urgency', 'medium'), 1.0)
        
        complexity_multiplier = 1.0 + (job_data.get('complexity_score', 5) - 5) * 0.1
        
        # Weather impact
        weather_multiplier = 1.1 if job_data.get('weather_dependent') and market_conditions.get('bad_weather', False) else 1.0
        
        # Demand-based pricing
        demand_multiplier = market_conditions.get('demand_multiplier', 1.0)
        
        # Calculate final rates
        final_hourly_rate = base_rate * urgency_multiplier * complexity_multiplier * weather_multiplier * demand_multiplier
        estimated_hours = job_data.get('estimated_duration', 4)
        uses_equipment = len(job_data.get('required_tools', [])) > 2
        
        labor_cost = final_hourly_rate * estimated_hours
        equipment_cost = equipment_rate * estimated_hours if uses_equipment else 0
        total_cost = labor_cost + equipment_cost
        
        return {
            'hourly_rate': round(final_hourly_rate, 2),
            'estimated_hours': estimated_hours,
            'labor_cost': round(labor_cost, 2),
            'equipment_cost': round(equipment_cost, 2),
            'total_cost': round(total_cost, 2),
            'profit_margin': round((total_cost * 0.3), 2),  # 30% profit margin
            'pricing_factors': {
                'urgency_multiplier': urgency_multiplier,
                'complexity_multiplier': complexity_multiplier,
                'weather_multiplier': weather_multiplier,
                'demand_multiplier': demand_multiplier
            }
        }
    
    def generate_performance_insights(self, historical_data: List[Dict]) -> Dict:
        """Generate performance insights and recommendations"""
        
        if not historical_data:
            return {"insights": [], "recommendations": []}
        
        # Analyze patterns
        total_jobs = len(historical_data)
        completed_jobs = [job for job in historical_data if job.get('status') == 'completed']
        completion_rate = len(completed_jobs) / total_jobs if total_jobs > 0 else 0
        
        avg_duration = sum([job.get('actual_duration', 0) for job in completed_jobs]) / len(completed_jobs) if completed_jobs else 0
        avg_cost = sum([job.get('actual_cost', 0) for job in completed_jobs]) / len(completed_jobs) if completed_jobs else 0
        
        insights = [
            f"Completion rate: {completion_rate:.1%}",
            f"Average job duration: {avg_duration:.1f} hours",
            f"Average job cost: €{avg_cost:.2f}"
        ]
        
        recommendations = []
        
        if completion_rate < 0.9:
            recommendations.append("Consider improving job planning to increase completion rate")
        
        if avg_duration > 6:
            recommendations.append("Look for opportunities to improve efficiency and reduce job duration")
        
        return {
            "insights": insights,
            "recommendations": recommendations,
            "performance_score": completion_rate * 100
        }

