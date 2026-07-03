import os
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from enum import Enum

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AIDecisionType(Enum):
    WORKER_ASSIGNMENT = "worker_assignment"
    JOB_SCHEDULING = "job_scheduling"
    PRICING_OPTIMIZATION = "pricing_optimization"
    RESOURCE_ALLOCATION = "resource_allocation"
    QUALITY_ASSESSMENT = "quality_assessment"
    RISK_ANALYSIS = "risk_analysis"
    CLIENT_COMMUNICATION = "client_communication"
    EMERGENCY_RESPONSE = "emergency_response"

@dataclass
class AIDecision:
    decision_type: AIDecisionType
    confidence: float
    reasoning: str
    recommended_actions: List[Dict[str, Any]]
    supporting_data: Dict[str, Any]
    risk_factors: List[str]
    estimated_impact: Dict[str, float]
    requires_approval: bool = False

@dataclass
class JobContext:
    job_id: int
    job_type: str
    priority: str
    location: str
    client_preferences: Dict[str, Any]
    required_skills: List[str]
    required_tools: List[str]
    estimated_duration: float
    weather_dependent: bool
    complexity_score: float

@dataclass
class WorkerContext:
    worker_id: int
    name: str
    skills: List[str]
    current_location: str
    availability: Dict[str, Any]
    performance_metrics: Dict[str, float]
    current_workload: int
    travel_time_to_job: float

LOCAL_SERVICE_PROFILES = {
    'garden_maintenance': {
        'keywords': ['garden', 'hedge', 'lawn', 'tree', 'yard', 'green waste', 'tuin', 'snoei'],
        'skills': ['garden_maintenance', 'green_waste_handling'],
        'tools': ['hedge_trimmer', 'rake', 'blower', 'ladder', 'green_waste_bags'],
        'materials': ['green_waste_bags'],
        'base_hours': 4.0,
        'base_cost': 280.0,
        'weather_dependent': True,
        'quality_checks': ['Edges finished', 'Waste removed', 'Client walkthrough photos captured']
    },
    'paving': {
        'keywords': ['paving', 'patio', 'driveway', 'slab', 'terrace', 'bestrating', 'tegelwerk buiten'],
        'skills': ['paving', 'groundwork', 'leveling'],
        'tools': ['plate_compactor', 'laser_level', 'wheelbarrow', 'shovel', 'tile_cutter'],
        'materials': ['sand', 'jointing_sand', 'paving_stones'],
        'base_hours': 12.0,
        'base_cost': 1450.0,
        'weather_dependent': True,
        'quality_checks': ['Sub-base compacted', 'Levels checked', 'Drainage slope verified']
    },
    'painting': {
        'keywords': ['paint', 'painting', 'wall', 'ceiling', 'schilder', 'verf'],
        'skills': ['painting', 'surface_preparation'],
        'tools': ['rollers', 'brushes', 'drop_cloths', 'sander', 'ladder'],
        'materials': ['primer', 'paint', 'masking_tape', 'filler'],
        'base_hours': 8.0,
        'base_cost': 650.0,
        'weather_dependent': False,
        'quality_checks': ['Surface prepared', 'Coverage even', 'Edges clean']
    },
    'renovation': {
        'keywords': ['renovation', 'bathroom', 'kitchen', 'demolition', 'tile', 'renovatie', 'badkamer', 'keuken'],
        'skills': ['renovation', 'demolition', 'tiling', 'finish_carpentry'],
        'tools': ['drill', 'multi_tool', 'tile_cutter', 'dust_extractor', 'level'],
        'materials': ['fasteners', 'sealant', 'tile_adhesive', 'grout'],
        'base_hours': 24.0,
        'base_cost': 3200.0,
        'weather_dependent': False,
        'quality_checks': ['Dust containment checked', 'Waterproofing verified', 'Client selections approved']
    },
    'fencing': {
        'keywords': ['fence', 'fencing', 'gate', 'schutting', 'hek'],
        'skills': ['fencing', 'post_setting', 'carpentry'],
        'tools': ['post_hole_digger', 'level', 'impact_driver', 'saw', 'string_line'],
        'materials': ['posts', 'panels', 'concrete_mix', 'gate_hardware'],
        'base_hours': 10.0,
        'base_cost': 1250.0,
        'weather_dependent': True,
        'quality_checks': ['Posts plumb', 'Gate swing checked', 'Debris removed']
    },
    'general_maintenance': {
        'keywords': ['repair', 'maintenance', 'handyman', 'fix', 'klus', 'onderhoud'],
        'skills': ['general_maintenance', 'client_coordination'],
        'tools': ['basic_tools', 'drill', 'ladder', 'measuring_tape'],
        'materials': ['standard_fasteners', 'sealant'],
        'base_hours': 4.0,
        'base_cost': 300.0,
        'weather_dependent': False,
        'quality_checks': ['Issue resolved', 'Work area cleaned', 'Completion photo captured']
    }
}

class ContractorAIEngine:
    """
    Advanced AI Engine for Contractor Business Automation
    
    This engine provides intelligent decision-making capabilities for:
    - Worker assignment and scheduling
    - Resource optimization
    - Predictive analytics
    - Quality control
    - Client communication
    - Risk assessment
    """
    
    def __init__(self):
        self.client = self._create_openai_client()
        self.decision_history = []
        self.learning_data = {}

    def _create_openai_client(self):
        if OpenAI is None or not os.environ.get("OPENAI_API_KEY"):
            return None
        try:
            return OpenAI()
        except Exception as e:
            logger.warning("OpenAI client unavailable, using fallback AI logic: %s", e)
            return None
        
    def analyze_job_request(self, job_data: Dict[str, Any]) -> AIDecision:
        """
        Analyze a new job request and provide comprehensive recommendations
        """
        try:
            if self.client is None:
                return self._create_local_job_decision(job_data, reason='local_rules_no_openai')

            # Extract job context
            context = self._extract_job_context(job_data)
            
            # Generate AI analysis
            analysis_prompt = self._create_job_analysis_prompt(context)
            
            response = self.client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {"role": "system", "content": self._get_contractor_system_prompt()},
                    {"role": "user", "content": analysis_prompt}
                ],
                temperature=0.3
            )
            
            # Parse AI response
            ai_response = json.loads(response.choices[0].message.content)
            
            # Create decision object
            decision = AIDecision(
                decision_type=AIDecisionType.WORKER_ASSIGNMENT,
                confidence=ai_response.get('confidence', 0.8),
                reasoning=ai_response.get('reasoning', ''),
                recommended_actions=ai_response.get('actions', []),
                supporting_data=ai_response.get('data', {}),
                risk_factors=ai_response.get('risks', []),
                estimated_impact=ai_response.get('impact', {}),
                requires_approval=ai_response.get('requires_approval', False)
            )
            
            # Store decision for learning
            self._store_decision(decision, context)
            
            return decision
            
        except Exception as e:
            logger.error(f"Error analyzing job request: {e}")
            return self._create_local_job_decision(job_data, reason='local_rules_after_ai_error')
    
    def optimize_worker_assignment(self, job_context: JobContext, available_workers: List[WorkerContext]) -> AIDecision:
        """
        Optimize worker assignment based on skills, location, availability, and performance
        """
        try:
            # Calculate worker scores
            worker_scores = []
            
            for worker in available_workers:
                score = self._calculate_worker_score(job_context, worker)
                worker_scores.append({
                    'worker_id': worker.worker_id,
                    'name': worker.name,
                    'score': score,
                    'reasoning': self._generate_worker_reasoning(job_context, worker, score)
                })
            
            # Sort by score
            worker_scores.sort(key=lambda x: x['score'], reverse=True)
            
            # Generate recommendation
            best_worker = worker_scores[0] if worker_scores else None
            
            if best_worker and best_worker['score'] > 0.7:
                confidence = min(best_worker['score'], 0.95)
                reasoning = f"Recommended {best_worker['name']} with {confidence*100:.0f}% confidence. {best_worker['reasoning']}"
                
                actions = [
                    {
                        'type': 'assign_worker',
                        'worker_id': best_worker['worker_id'],
                        'worker_name': best_worker['name'],
                        'estimated_start': self._calculate_optimal_start_time(job_context, available_workers[0]),
                        'estimated_duration': job_context.estimated_duration
                    }
                ]
                
                return AIDecision(
                    decision_type=AIDecisionType.WORKER_ASSIGNMENT,
                    confidence=confidence,
                    reasoning=reasoning,
                    recommended_actions=actions,
                    supporting_data={'worker_scores': worker_scores[:3]},
                    risk_factors=self._identify_assignment_risks(job_context, available_workers[0]),
                    estimated_impact={'efficiency': 0.9, 'client_satisfaction': 0.85},
                    requires_approval=best_worker['score'] < 0.8
                )
            else:
                return self._create_no_worker_available_decision(job_context, worker_scores)
                
        except Exception as e:
            logger.error(f"Error optimizing worker assignment: {e}")
            return self._create_fallback_decision()
    
    def analyze_image_for_job_progress(self, image_path: str, job_context: JobContext) -> AIDecision:
        """
        Analyze job site images to assess progress and quality
        """
        try:
            # For now, simulate computer vision analysis
            # In production, this would use actual image analysis
            
            analysis_prompt = f"""
            Analyze this job site image for a {job_context.job_type} project.
            
            Job Context:
            - Type: {job_context.job_type}
            - Priority: {job_context.priority}
            - Expected completion: {job_context.estimated_duration} hours
            
            Please provide:
            1. Progress assessment (0-100%)
            2. Quality observations
            3. Safety compliance check
            4. Any issues or concerns
            5. Recommendations for next steps
            
            Return as JSON with fields: progress_percentage, quality_score, safety_issues, observations, recommendations
            """
            
            # Simulate AI vision analysis
            mock_analysis = {
                "progress_percentage": 75,
                "quality_score": 0.9,
                "safety_issues": [],
                "observations": [
                    "Work area is clean and organized",
                    "Materials are properly stored",
                    "Progress appears on schedule"
                ],
                "recommendations": [
                    "Continue current approach",
                    "Schedule quality check before final phase"
                ]
            }
            
            return AIDecision(
                decision_type=AIDecisionType.QUALITY_ASSESSMENT,
                confidence=0.85,
                reasoning=f"Image analysis shows {mock_analysis['progress_percentage']}% completion with high quality standards maintained.",
                recommended_actions=[
                    {
                        'type': 'update_progress',
                        'progress_percentage': mock_analysis['progress_percentage']
                    }
                ],
                supporting_data=mock_analysis,
                risk_factors=[],
                estimated_impact={'quality': 0.9, 'timeline': 0.95}
            )
            
        except Exception as e:
            logger.error(f"Error analyzing image: {e}")
            return self._create_fallback_decision()
    
    def generate_client_communication(self, communication_context: Dict[str, Any]) -> str:
        """
        Generate appropriate client communication based on context
        """
        try:
            if self.client is None:
                return self._create_local_client_message(communication_context)

            prompt = f"""
            Generate a professional WhatsApp message for the following situation:
            
            Context: {communication_context.get('context', '')}
            Client Name: {communication_context.get('client_name', '')}
            Job Type: {communication_context.get('job_type', '')}
            Status: {communication_context.get('status', '')}
            
            Requirements:
            - Professional but friendly tone
            - Clear and concise
            - Include relevant details
            - Appropriate for WhatsApp format
            - Maximum 160 characters if possible
            
            Message:
            """
            
            response = self.client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {"role": "system", "content": "You are a professional contractor's AI assistant. Generate clear, friendly communication."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=150
            )
            
            return response.choices[0].message.content.strip()
            
        except Exception as e:
            logger.error(f"Error generating communication: {e}")
            return self._create_local_client_message(communication_context)
    
    def predict_job_completion_time(self, job_context: JobContext, worker_context: WorkerContext) -> Dict[str, Any]:
        """
        Predict realistic job completion time based on multiple factors
        """
        try:
            base_duration = job_context.estimated_duration
            
            # Adjust for worker efficiency
            efficiency_factor = worker_context.performance_metrics.get('efficiency', 1.0)
            
            # Adjust for complexity
            complexity_factor = 1 + (job_context.complexity_score - 1) * 0.2
            
            # Adjust for weather (if applicable)
            weather_factor = 1.0
            if job_context.weather_dependent:
                # This would integrate with actual weather data
                weather_factor = 1.1  # Assume slight delay for weather
            
            # Calculate predicted duration
            predicted_duration = base_duration * complexity_factor * weather_factor / efficiency_factor
            
            # Add buffer based on job type and priority
            buffer_percentage = 0.15 if job_context.priority in ['high', 'critical'] else 0.25
            buffered_duration = predicted_duration * (1 + buffer_percentage)
            
            return {
                'base_estimate': base_duration,
                'predicted_duration': predicted_duration,
                'buffered_duration': buffered_duration,
                'confidence': 0.8,
                'factors': {
                    'worker_efficiency': efficiency_factor,
                    'job_complexity': complexity_factor,
                    'weather_impact': weather_factor,
                    'buffer_applied': buffer_percentage
                }
            }
            
        except Exception as e:
            logger.error(f"Error predicting completion time: {e}")
            return {
                'base_estimate': job_context.estimated_duration,
                'predicted_duration': job_context.estimated_duration * 1.2,
                'buffered_duration': job_context.estimated_duration * 1.3,
                'confidence': 0.5,
                'factors': {}
            }
    
    def assess_business_opportunities(self, historical_data: Dict[str, Any]) -> List[AIDecision]:
        """
        Analyze business data to identify growth opportunities
        """
        try:
            opportunities = []
            
            # Revenue growth opportunities
            revenue_analysis = self._analyze_revenue_patterns(historical_data)
            if revenue_analysis['growth_potential'] > 0.2:
                opportunities.append(AIDecision(
                    decision_type=AIDecisionType.PRICING_OPTIMIZATION,
                    confidence=0.75,
                    reasoning="Revenue analysis shows 20%+ growth potential through service expansion",
                    recommended_actions=[
                        {
                            'type': 'expand_services',
                            'recommended_services': revenue_analysis['recommended_services'],
                            'expected_revenue_increase': revenue_analysis['growth_potential']
                        }
                    ],
                    supporting_data=revenue_analysis,
                    risk_factors=['market_competition', 'resource_constraints'],
                    estimated_impact={'revenue': revenue_analysis['growth_potential']}
                ))
            
            # Efficiency improvements
            efficiency_analysis = self._analyze_efficiency_patterns(historical_data)
            if efficiency_analysis['improvement_potential'] > 0.15:
                opportunities.append(AIDecision(
                    decision_type=AIDecisionType.RESOURCE_ALLOCATION,
                    confidence=0.8,
                    reasoning="Efficiency analysis identifies 15%+ improvement potential",
                    recommended_actions=[
                        {
                            'type': 'optimize_scheduling',
                            'recommendations': efficiency_analysis['recommendations']
                        }
                    ],
                    supporting_data=efficiency_analysis,
                    risk_factors=['worker_adaptation', 'client_expectations'],
                    estimated_impact={'efficiency': efficiency_analysis['improvement_potential']}
                ))
            
            return opportunities
            
        except Exception as e:
            logger.error(f"Error assessing business opportunities: {e}")
            return []
    
    # Private helper methods
    def _extract_job_context(self, job_data: Dict[str, Any]) -> JobContext:
        """Extract structured context from job data"""
        return JobContext(
            job_id=job_data.get('id', 0),
            job_type=job_data.get('job_type', 'general'),
            priority=job_data.get('priority', 'medium'),
            location=job_data.get('location', ''),
            client_preferences=job_data.get('client_preferences', {}),
            required_skills=job_data.get('required_skills', []),
            required_tools=job_data.get('required_tools', []),
            estimated_duration=job_data.get('estimated_duration', 4.0),
            weather_dependent=job_data.get('weather_dependent', False),
            complexity_score=job_data.get('complexity_score', 1.0)
        )

    def _create_local_job_decision(self, job_data: Dict[str, Any], reason: str) -> AIDecision:
        """Create deterministic operating-ledger recommendations without external AI."""
        profile_key, profile = self._match_service_profile(job_data)
        text = self._job_text(job_data)
        priority = self._detect_priority(job_data, text)
        complexity = self._estimate_complexity(job_data, text, profile_key)
        duration = float(job_data.get('estimated_duration') or profile['base_hours']) * (1 + max(complexity - 3, 0) * 0.12)
        estimate = round(float(job_data.get('estimated_cost') or profile['base_cost']) * (1 + max(complexity - 3, 0) * 0.08), 2)
        missing = self._missing_intake_fields(job_data)
        approval_required = True
        risk_factors = self._local_risk_factors(job_data, priority, profile)

        quote_draft = {
            'scope': self._scope_summary(profile_key, job_data),
            'estimatedHours': round(duration, 1),
            'estimatedPrice': estimate,
            'currency': 'EUR',
            'approvalRequired': True,
            'safeState': 'draft_only'
        }

        actions = [
            {
                'type': 'create_job_request_draft',
                'risk': 'low',
                'approval_required': False,
                'title': job_data.get('title') or self._scope_summary(profile_key, job_data),
                'service_type': profile_key,
                'priority': priority
            },
            {
                'type': 'prepare_quote_draft',
                'risk': 'medium',
                'approval_required': True,
                'quote': quote_draft
            },
            {
                'type': 'prepare_worker_instruction_draft',
                'risk': 'medium',
                'approval_required': True,
                'instructions': [
                    f"Confirm scope and access before starting {profile_key.replace('_', ' ')} work.",
                    f"Bring: {', '.join(profile['tools'])}.",
                    f"Quality checks: {', '.join(profile['quality_checks'])}."
                ]
            },
            {
                'type': 'reserve_tool_draft',
                'risk': 'medium',
                'approval_required': True,
                'tools': profile['tools']
            }
        ]

        if missing:
            actions.insert(1, {
                'type': 'request_missing_client_information',
                'risk': 'low',
                'approval_required': True,
                'missing': missing,
                'questions': self._client_questions(missing)
            })

        if profile['weather_dependent']:
            actions.append({
                'type': 'assess_weather_before_committing_date',
                'risk': 'medium',
                'approval_required': True,
                'message': 'Outdoor work should not be committed until the weather window is checked.'
            })

        decision = AIDecision(
            decision_type=AIDecisionType.JOB_SCHEDULING if profile['weather_dependent'] else AIDecisionType.RESOURCE_ALLOCATION,
            confidence=0.72 if missing else 0.82,
            reasoning=(
                f"Local contractor rules classified this as {profile_key.replace('_', ' ')} "
                f"with {priority} priority. The system created internal drafts only; quotes, "
                "tool reservations, worker assignment, schedule commitments, and client messages require approval."
            ),
            recommended_actions=actions,
            supporting_data={
                'mode': reason,
                'serviceProfile': profile_key,
                'requiredSkills': profile['skills'],
                'requiredTools': profile['tools'],
                'materialsNeeded': profile['materials'],
                'qualityCheckpoints': profile['quality_checks'],
                'missingInformation': missing,
                'quoteDraft': quote_draft,
                'operatingLedgerFields': {
                    'service_type': profile_key,
                    'priority': priority,
                    'estimated_duration': round(duration, 1),
                    'estimated_cost': estimate,
                    'weather_sensitive': profile['weather_dependent'],
                    'approval_status': 'draft_requires_review'
                },
                'autonomyPolicy': {
                    'internalDraftsAllowed': True,
                    'externalCommunicationAllowed': False,
                    'clientCommitmentAllowed': False,
                    'spendAllowed': False
                }
            },
            risk_factors=risk_factors,
            estimated_impact={
                'coordination_time_saved_hours': 1.5,
                'missed_commitment_risk_reduction': 0.35,
                'quote_confidence': 0.62 if missing else 0.78
            },
            requires_approval=approval_required
        )
        self._store_decision(decision, {'local_job_data': job_data, 'profile': profile_key})
        return decision

    def _match_service_profile(self, job_data: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        explicit = str(job_data.get('service_type') or job_data.get('job_type') or '').lower().replace('-', '_').replace(' ', '_')
        if explicit in LOCAL_SERVICE_PROFILES:
            return explicit, LOCAL_SERVICE_PROFILES[explicit]

        text = self._job_text(job_data)
        matches = []
        for key, profile in LOCAL_SERVICE_PROFILES.items():
            score = sum(1 for keyword in profile['keywords'] if keyword in text)
            if score:
                matches.append((score, key, profile))
        if matches:
            matches.sort(key=lambda item: (item[0], item[1] != 'general_maintenance'), reverse=True)
            _, key, profile = matches[0]
            return key, profile
        return 'general_maintenance', LOCAL_SERVICE_PROFILES['general_maintenance']

    def _job_text(self, job_data: Dict[str, Any]) -> str:
        parts = [
            job_data.get('title'),
            job_data.get('description'),
            job_data.get('message'),
            job_data.get('client_message'),
            job_data.get('scope')
        ]
        return ' '.join(str(part or '') for part in parts).lower()

    def _detect_priority(self, job_data: Dict[str, Any], text: str) -> str:
        provided = str(job_data.get('priority') or job_data.get('urgency') or '').lower()
        if provided in {'emergency', 'critical', 'high', 'medium', 'low'}:
            return 'critical' if provided == 'emergency' else provided
        if any(term in text for term in ['leak', 'unsafe', 'danger', 'blocked', 'emergency', 'spoed']):
            return 'critical'
        if any(term in text for term in ['tomorrow', 'urgent', 'asap', 'this week', 'snel']):
            return 'high'
        return 'medium'

    def _estimate_complexity(self, job_data: Dict[str, Any], text: str, profile_key: str) -> float:
        provided = job_data.get('complexity_score')
        if isinstance(provided, (int, float)):
            return max(1.0, min(float(provided), 5.0))
        complexity = 2.0
        if profile_key in {'renovation', 'paving'}:
            complexity += 1.2
        if any(term in text for term in ['large', 'multiple', 'full', 'complete', 'entire', 'groot']):
            complexity += 1.0
        if any(term in text for term in ['damage', 'leak', 'mold', 'rot', 'unsafe', 'crack']):
            complexity += 0.8
        return max(1.0, min(complexity, 5.0))

    def _missing_intake_fields(self, job_data: Dict[str, Any]) -> List[str]:
        field_map = {
            'client_name': ['client_name', 'clientName', 'client'],
            'address': ['address', 'location', 'job_address'],
            'desired_date': ['desired_date', 'requested_date', 'planned_start'],
            'contact_method': ['email', 'phone', 'contact_method']
        }
        missing = []
        for label, keys in field_map.items():
            if not any(job_data.get(key) for key in keys):
                missing.append(label)
        return missing

    def _client_questions(self, missing: List[str]) -> List[str]:
        questions = {
            'client_name': 'What name should we put on the job and quote?',
            'address': 'What is the exact work address and access situation?',
            'desired_date': 'Do you have a preferred date or deadline?',
            'contact_method': 'What phone number or email should we use for approvals?'
        }
        return [questions[item] for item in missing if item in questions]

    def _local_risk_factors(self, job_data: Dict[str, Any], priority: str, profile: Dict[str, Any]) -> List[str]:
        risks = []
        if priority in {'critical', 'high'}:
            risks.append('time_sensitive_client_expectation')
        if profile['weather_dependent']:
            risks.append('weather_dependent_work')
        if not job_data.get('address') and not job_data.get('location'):
            risks.append('missing_job_location')
        if float(job_data.get('estimated_cost') or profile['base_cost']) >= 1000:
            risks.append('quote_value_requires_review')
        return risks or ['standard_contractor_review']

    def _scope_summary(self, profile_key: str, job_data: Dict[str, Any]) -> str:
        supplied = job_data.get('title') or job_data.get('scope')
        if supplied:
            return str(supplied)
        return f"{profile_key.replace('_', ' ').title()} job intake and quote draft"

    def _create_local_client_message(self, communication_context: Dict[str, Any]) -> str:
        client_name = communication_context.get('client_name') or 'there'
        job_type = communication_context.get('job_type') or communication_context.get('service_type') or 'the requested work'
        status = communication_context.get('status') or 'received'
        return (
            f"Draft for approval: Hi {client_name}, we received your {job_type} request. "
            f"Status: {status}. We will confirm scope, timing, and price before any commitment."
        )
    
    def _calculate_worker_score(self, job_context: JobContext, worker_context: WorkerContext) -> float:
        """Calculate worker suitability score for a job"""
        score = 0.0
        
        # Skills match (40% of score)
        skill_match = len(set(job_context.required_skills) & set(worker_context.skills)) / max(len(job_context.required_skills), 1)
        score += skill_match * 0.4
        
        # Performance metrics (30% of score)
        performance_score = (
            worker_context.performance_metrics.get('success_rate', 0.8) * 0.4 +
            worker_context.performance_metrics.get('efficiency', 0.8) * 0.3 +
            worker_context.performance_metrics.get('quality', 0.8) * 0.3
        )
        score += performance_score * 0.3
        
        # Availability (20% of score)
        availability_score = 1.0 if worker_context.current_workload < 3 else 0.5
        score += availability_score * 0.2
        
        # Location proximity (10% of score)
        # Simplified: assume travel time affects score
        location_score = max(0, 1 - (worker_context.travel_time_to_job / 60))  # Penalize long travel
        score += location_score * 0.1
        
        return min(score, 1.0)
    
    def _generate_worker_reasoning(self, job_context: JobContext, worker_context: WorkerContext, score: float) -> str:
        """Generate human-readable reasoning for worker selection"""
        reasons = []
        
        skill_match = len(set(job_context.required_skills) & set(worker_context.skills))
        if skill_match > 0:
            reasons.append(f"Has {skill_match} required skills")
        
        if worker_context.performance_metrics.get('success_rate', 0) > 0.9:
            reasons.append("Excellent success rate")
        
        if worker_context.travel_time_to_job < 30:
            reasons.append("Close to job location")
        
        if worker_context.current_workload < 2:
            reasons.append("Low current workload")
        
        return "; ".join(reasons) if reasons else "Basic qualifications met"
    
    def _calculate_optimal_start_time(self, job_context: JobContext, worker_context: WorkerContext) -> str:
        """Calculate optimal start time for a job"""
        # Simplified logic - in production would consider many more factors
        now = datetime.now()
        
        if job_context.priority in ['critical', 'emergency']:
            start_time = now + timedelta(hours=1)
        elif job_context.priority == 'high':
            start_time = now + timedelta(hours=4)
        else:
            start_time = now + timedelta(days=1)
        
        return start_time.strftime('%Y-%m-%d %H:%M')
    
    def _identify_assignment_risks(self, job_context: JobContext, worker_context: WorkerContext) -> List[str]:
        """Identify potential risks with the assignment"""
        risks = []
        
        if worker_context.travel_time_to_job > 45:
            risks.append("Long travel time may affect efficiency")
        
        if job_context.complexity_score > 2.0:
            risks.append("High complexity job requires careful monitoring")
        
        if job_context.weather_dependent:
            risks.append("Weather conditions may cause delays")
        
        return risks
    
    def _create_job_analysis_prompt(self, context: JobContext) -> str:
        """Create prompt for job analysis"""
        return f"""
        Analyze this job request and provide recommendations:
        
        Job Details:
        - Type: {context.job_type}
        - Priority: {context.priority}
        - Location: {context.location}
        - Required Skills: {', '.join(context.required_skills)}
        - Estimated Duration: {context.estimated_duration} hours
        - Complexity: {context.complexity_score}/5
        
        Provide analysis as JSON with:
        - confidence (0-1)
        - reasoning (string)
        - actions (array of recommended actions)
        - risks (array of risk factors)
        - impact (object with estimated impacts)
        - requires_approval (boolean)
        """
    
    def _get_contractor_system_prompt(self) -> str:
        """Get the system prompt for contractor AI"""
        return """
        You are an advanced AI assistant for a contractor business. You have expertise in:
        - Job scheduling and resource allocation
        - Worker assignment and management
        - Quality control and safety
        - Client communication and satisfaction
        - Business optimization and growth
        
        Always provide practical, actionable recommendations with clear reasoning.
        Consider efficiency, quality, safety, and profitability in all decisions.
        Be conservative with risk assessment and always prioritize safety.
        """
    
    def _analyze_revenue_patterns(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze historical revenue data for patterns"""
        # Simplified analysis - would be much more sophisticated in production
        return {
            'growth_potential': 0.25,
            'recommended_services': ['bathroom_renovation', 'landscaping'],
            'seasonal_trends': {'summer': 1.3, 'winter': 0.8}
        }
    
    def _analyze_efficiency_patterns(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze efficiency patterns"""
        return {
            'improvement_potential': 0.18,
            'recommendations': [
                'Optimize travel routes',
                'Batch similar jobs',
                'Improve tool management'
            ]
        }
    
    def _create_fallback_decision(self) -> AIDecision:
        """Create a safe fallback decision when AI analysis fails"""
        return AIDecision(
            decision_type=AIDecisionType.WORKER_ASSIGNMENT,
            confidence=0.5,
            reasoning="AI analysis unavailable. Manual review recommended.",
            recommended_actions=[
                {
                    'type': 'manual_review',
                    'message': 'Please review this job manually'
                }
            ],
            supporting_data={},
            risk_factors=['ai_system_unavailable'],
            estimated_impact={},
            requires_approval=True
        )
    
    def _create_no_worker_available_decision(self, job_context: JobContext, worker_scores: List[Dict]) -> AIDecision:
        """Create decision when no suitable worker is available"""
        return AIDecision(
            decision_type=AIDecisionType.WORKER_ASSIGNMENT,
            confidence=0.9,
            reasoning="No workers available with suitable skills and availability.",
            recommended_actions=[
                {
                    'type': 'schedule_later',
                    'message': 'Schedule for when suitable worker becomes available'
                },
                {
                    'type': 'subcontract',
                    'message': 'Consider subcontracting this job'
                }
            ],
            supporting_data={'worker_scores': worker_scores},
            risk_factors=['resource_shortage', 'client_delay'],
            estimated_impact={'client_satisfaction': -0.2},
            requires_approval=True
        )
    
    def _store_decision(self, decision: AIDecision, context: Any):
        """Store decision for learning and improvement"""
        self.decision_history.append({
            'timestamp': datetime.now(),
            'decision': decision,
            'context': context
        })
        
        # Keep only recent decisions (last 1000)
        if len(self.decision_history) > 1000:
            self.decision_history = self.decision_history[-1000:]

