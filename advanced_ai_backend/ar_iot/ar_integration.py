"""
AR (Augmented Reality) Support and IoT Integration Module
Provides AR visualization, IoT device management, and real-time monitoring capabilities
"""

import json
import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
import logging
import websockets
from dataclasses import dataclass

@dataclass
class ARVisualization:
    """AR visualization configuration"""
    scene_id: str
    objects: List[Dict[str, Any]]
    annotations: List[Dict[str, Any]]
    measurements: List[Dict[str, Any]]
    overlay_data: Dict[str, Any]

@dataclass
class IoTDevice:
    """IoT device representation"""
    device_id: str
    device_type: str
    location: str
    status: str
    last_update: datetime
    data: Dict[str, Any]
    battery_level: Optional[float] = None
    signal_strength: Optional[float] = None

class ARIoTIntegration:
    """
    Advanced AR and IoT integration system for contractor operations
    Provides real-time visualization, remote monitoring, and intelligent automation
    """
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.iot_devices = {}
        self.ar_sessions = {}
        self.websocket_connections = {}
        self.initialize_systems()
    
    def initialize_systems(self):
        """Initialize AR and IoT systems"""
        self.setup_iot_monitoring()
        self.setup_ar_engine()
        self.setup_real_time_communication()
        self.logger.info("AR and IoT systems initialized successfully")
    
    # AR Support Functions
    async def create_ar_session(self, job_id: str, location: Dict[str, float]) -> Dict[str, Any]:
        """
        Create AR session for job site visualization
        
        Args:
            job_id: Unique job identifier
            location: GPS coordinates and orientation
            
        Returns:
            Dict containing AR session configuration
        """
        try:
            session_id = f"ar_session_{job_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            
            # Get job-specific data
            job_data = await self._get_job_data(job_id)
            
            # Create AR visualization
            ar_config = self._create_ar_visualization(job_data, location)
            
            # Initialize AR session
            session = {
                'session_id': session_id,
                'job_id': job_id,
                'location': location,
                'ar_config': ar_config,
                'created_at': datetime.now().isoformat(),
                'status': 'active',
                'participants': [],
                'shared_annotations': [],
                'measurements': [],
                'progress_tracking': {
                    'completion_percentage': 0,
                    'quality_checkpoints': [],
                    'time_tracking': {'start_time': datetime.now().isoformat()}
                }
            }
            
            self.ar_sessions[session_id] = session
            
            return {
                'session_id': session_id,
                'ar_config': ar_config,
                'qr_code_data': self._generate_ar_qr_code(session_id),
                'mobile_app_link': f"contractorai://ar/{session_id}",
                'web_ar_link': f"https://ar.contractorai.com/{session_id}",
                'initialization_instructions': self._get_ar_instructions(job_data['job_type'])
            }
            
        except Exception as e:
            self.logger.error(f"Error creating AR session: {str(e)}")
            return {'error': str(e)}
    
    def _create_ar_visualization(self, job_data: Dict, location: Dict) -> Dict[str, Any]:
        """Create AR visualization configuration based on job type"""
        job_type = job_data.get('job_type', 'general')
        
        ar_configs = {
            'bathroom_renovation': self._create_bathroom_ar_config,
            'kitchen_renovation': self._create_kitchen_ar_config,
            'garden_maintenance': self._create_garden_ar_config,
            'plumbing': self._create_plumbing_ar_config,
            'electrical': self._create_electrical_ar_config,
            'roofing': self._create_roofing_ar_config
        }
        
        config_func = ar_configs.get(job_type, self._create_general_ar_config)
        return config_func(job_data, location)
    
    def _create_bathroom_ar_config(self, job_data: Dict, location: Dict) -> Dict[str, Any]:
        """Create AR configuration for bathroom renovation"""
        return {
            'scene_type': 'indoor_renovation',
            'measurement_tools': [
                {'type': 'tape_measure', 'precision': 'mm'},
                {'type': 'level_indicator', 'axis': 'all'},
                {'type': 'angle_measure', 'precision': 'degrees'}
            ],
            'overlay_elements': [
                {
                    'type': 'dimension_lines',
                    'style': 'architectural',
                    'color': '#00ff00',
                    'thickness': 2
                },
                {
                    'type': 'material_overlay',
                    'materials': ['tiles', 'fixtures', 'pipes'],
                    'transparency': 0.7
                },
                {
                    'type': 'progress_indicators',
                    'checkpoints': [
                        'demolition_complete',
                        'plumbing_rough_in',
                        'electrical_rough_in',
                        'drywall_complete',
                        'tiling_complete',
                        'fixtures_installed'
                    ]
                }
            ],
            'quality_checkpoints': [
                {
                    'name': 'Tile Alignment',
                    'type': 'visual_inspection',
                    'tolerance': '±2mm',
                    'ar_guide': 'overlay_grid_pattern'
                },
                {
                    'name': 'Fixture Placement',
                    'type': 'measurement_verification',
                    'specifications': job_data.get('specifications', {}),
                    'ar_guide': 'dimension_overlay'
                }
            ],
            'safety_overlays': [
                {
                    'type': 'hazard_zones',
                    'areas': ['electrical_work', 'wet_areas'],
                    'color': '#ff0000',
                    'warning_text': True
                }
            ]
        }
    
    def _create_garden_ar_config(self, job_data: Dict, location: Dict) -> Dict[str, Any]:
        """Create AR configuration for garden maintenance"""
        return {
            'scene_type': 'outdoor_maintenance',
            'measurement_tools': [
                {'type': 'area_calculator', 'unit': 'square_meters'},
                {'type': 'plant_identifier', 'database': 'garden_plants'},
                {'type': 'growth_tracker', 'time_lapse': True}
            ],
            'overlay_elements': [
                {
                    'type': 'area_boundaries',
                    'zones': ['lawn', 'flower_beds', 'trees', 'pathways'],
                    'color_coded': True
                },
                {
                    'type': 'maintenance_schedule',
                    'tasks': job_data.get('tasks', []),
                    'priority_indicators': True
                },
                {
                    'type': 'weather_overlay',
                    'real_time': True,
                    'forecast': '24h'
                }
            ],
            'plant_care_guides': [
                {
                    'type': 'watering_indicators',
                    'soil_moisture': 'sensor_based',
                    'visual_cues': True
                },
                {
                    'type': 'pruning_guides',
                    'seasonal': True,
                    'plant_specific': True
                }
            ]
        }
    
    def _create_general_ar_config(self, job_data: Dict, location: Dict) -> Dict[str, Any]:
        """Create general AR configuration"""
        return {
            'scene_type': 'general_work',
            'measurement_tools': [
                {'type': 'basic_measure', 'units': ['cm', 'm']},
                {'type': 'photo_annotation', 'voice_notes': True}
            ],
            'overlay_elements': [
                {
                    'type': 'work_instructions',
                    'step_by_step': True,
                    'interactive': True
                },
                {
                    'type': 'progress_tracking',
                    'percentage_based': True,
                    'photo_comparison': True
                }
            ]
        }
    
    async def update_ar_progress(self, session_id: str, progress_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Update AR session with progress data
        
        Args:
            session_id: AR session identifier
            progress_data: Progress information and measurements
            
        Returns:
            Dict containing updated session status
        """
        try:
            if session_id not in self.ar_sessions:
                return {'error': 'AR session not found'}
            
            session = self.ar_sessions[session_id]
            
            # Update progress tracking
            session['progress_tracking'].update(progress_data)
            
            # Add measurements if provided
            if 'measurements' in progress_data:
                session['measurements'].extend(progress_data['measurements'])
            
            # Add annotations if provided
            if 'annotations' in progress_data:
                session['shared_annotations'].extend(progress_data['annotations'])
            
            # Calculate completion percentage
            completion = self._calculate_ar_completion(session)
            session['progress_tracking']['completion_percentage'] = completion
            
            # Generate quality assessment
            quality_assessment = self._assess_ar_quality(session)
            
            # Notify connected clients
            await self._broadcast_ar_update(session_id, {
                'type': 'progress_update',
                'completion': completion,
                'quality_assessment': quality_assessment,
                'timestamp': datetime.now().isoformat()
            })
            
            return {
                'success': True,
                'completion_percentage': completion,
                'quality_assessment': quality_assessment,
                'next_steps': self._get_next_ar_steps(session)
            }
            
        except Exception as e:
            self.logger.error(f"Error updating AR progress: {str(e)}")
            return {'error': str(e)}
    
    # IoT Integration Functions
    async def register_iot_device(self, device_config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Register new IoT device for monitoring
        
        Args:
            device_config: Device configuration and capabilities
            
        Returns:
            Dict containing device registration status
        """
        try:
            device_id = device_config.get('device_id')
            if not device_id:
                return {'error': 'Device ID is required'}
            
            device = IoTDevice(
                device_id=device_id,
                device_type=device_config.get('device_type', 'unknown'),
                location=device_config.get('location', 'unknown'),
                status='online',
                last_update=datetime.now(),
                data={},
                battery_level=device_config.get('battery_level'),
                signal_strength=device_config.get('signal_strength')
            )
            
            self.iot_devices[device_id] = device
            
            # Setup device monitoring
            await self._setup_device_monitoring(device)
            
            # Configure device-specific features
            device_features = self._configure_device_features(device_config)
            
            return {
                'success': True,
                'device_id': device_id,
                'status': 'registered',
                'features': device_features,
                'monitoring_interval': device_config.get('monitoring_interval', 60),
                'api_endpoints': self._generate_device_endpoints(device_id)
            }
            
        except Exception as e:
            self.logger.error(f"Error registering IoT device: {str(e)}")
            return {'error': str(e)}
    
    def _configure_device_features(self, device_config: Dict) -> Dict[str, Any]:
        """Configure device-specific features based on type"""
        device_type = device_config.get('device_type', 'unknown')
        
        feature_configs = {
            'environmental_sensor': {
                'measurements': ['temperature', 'humidity', 'air_quality'],
                'alerts': ['extreme_temperature', 'high_humidity', 'poor_air_quality'],
                'automation': ['hvac_control', 'ventilation_control']
            },
            'security_camera': {
                'features': ['motion_detection', 'facial_recognition', 'object_detection'],
                'alerts': ['unauthorized_access', 'equipment_theft', 'safety_violations'],
                'automation': ['automatic_recording', 'alert_notifications']
            },
            'tool_tracker': {
                'tracking': ['location', 'usage_time', 'maintenance_status'],
                'alerts': ['tool_missing', 'maintenance_due', 'battery_low'],
                'automation': ['usage_logging', 'maintenance_scheduling']
            },
            'safety_monitor': {
                'monitoring': ['worker_presence', 'safety_equipment', 'hazard_detection'],
                'alerts': ['safety_violation', 'emergency_situation', 'worker_down'],
                'automation': ['emergency_response', 'safety_compliance_logging']
            },
            'progress_camera': {
                'capture': ['time_lapse', 'progress_photos', 'quality_inspection'],
                'analysis': ['completion_tracking', 'quality_assessment', 'issue_detection'],
                'automation': ['progress_reporting', 'client_updates']
            }
        }
        
        return feature_configs.get(device_type, {
            'basic_monitoring': ['status', 'connectivity'],
            'alerts': ['device_offline', 'battery_low'],
            'automation': ['status_reporting']
        })
    
    async def process_iot_data(self, device_id: str, sensor_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process incoming IoT sensor data
        
        Args:
            device_id: Device identifier
            sensor_data: Raw sensor data
            
        Returns:
            Dict containing processing results and actions
        """
        try:
            if device_id not in self.iot_devices:
                return {'error': 'Device not registered'}
            
            device = self.iot_devices[device_id]
            
            # Update device data
            device.data.update(sensor_data)
            device.last_update = datetime.now()
            
            # Process data based on device type
            processing_result = self._process_device_data(device, sensor_data)
            
            # Check for alerts
            alerts = self._check_device_alerts(device, sensor_data)
            
            # Trigger automation if needed
            automation_actions = await self._trigger_device_automation(device, sensor_data, alerts)
            
            # Update device status
            device.status = self._determine_device_status(device, sensor_data)
            
            return {
                'success': True,
                'device_id': device_id,
                'processed_data': processing_result,
                'alerts': alerts,
                'automation_actions': automation_actions,
                'device_status': device.status,
                'timestamp': device.last_update.isoformat()
            }
            
        except Exception as e:
            self.logger.error(f"Error processing IoT data: {str(e)}")
            return {'error': str(e)}
    
    def _process_device_data(self, device: IoTDevice, sensor_data: Dict) -> Dict[str, Any]:
        """Process sensor data based on device type"""
        processors = {
            'environmental_sensor': self._process_environmental_data,
            'security_camera': self._process_camera_data,
            'tool_tracker': self._process_tool_data,
            'safety_monitor': self._process_safety_data,
            'progress_camera': self._process_progress_data
        }
        
        processor = processors.get(device.device_type, self._process_generic_data)
        return processor(device, sensor_data)
    
    def _process_environmental_data(self, device: IoTDevice, data: Dict) -> Dict[str, Any]:
        """Process environmental sensor data"""
        return {
            'temperature': {
                'value': data.get('temperature', 0),
                'unit': 'celsius',
                'status': 'normal' if 15 <= data.get('temperature', 20) <= 30 else 'alert'
            },
            'humidity': {
                'value': data.get('humidity', 0),
                'unit': 'percentage',
                'status': 'normal' if 30 <= data.get('humidity', 50) <= 70 else 'alert'
            },
            'air_quality': {
                'value': data.get('air_quality', 0),
                'unit': 'aqi',
                'status': 'good' if data.get('air_quality', 50) <= 100 else 'poor'
            }
        }
    
    def _process_camera_data(self, device: IoTDevice, data: Dict) -> Dict[str, Any]:
        """Process security camera data"""
        return {
            'motion_detected': data.get('motion_detected', False),
            'objects_detected': data.get('objects_detected', []),
            'faces_detected': data.get('faces_detected', []),
            'recording_status': data.get('recording_status', 'idle'),
            'storage_usage': data.get('storage_usage', 0)
        }
    
    def _process_tool_data(self, device: IoTDevice, data: Dict) -> Dict[str, Any]:
        """Process tool tracker data"""
        return {
            'location': data.get('location', {}),
            'usage_status': data.get('usage_status', 'idle'),
            'battery_level': data.get('battery_level', 100),
            'maintenance_status': data.get('maintenance_status', 'good'),
            'last_used': data.get('last_used', datetime.now().isoformat())
        }
    
    def _process_safety_data(self, device: IoTDevice, data: Dict) -> Dict[str, Any]:
        """Process safety monitor data"""
        return {
            'workers_present': data.get('workers_present', 0),
            'safety_equipment_detected': data.get('safety_equipment_detected', []),
            'hazards_detected': data.get('hazards_detected', []),
            'emergency_status': data.get('emergency_status', 'normal'),
            'compliance_score': data.get('compliance_score', 100)
        }
    
    def _process_progress_data(self, device: IoTDevice, data: Dict) -> Dict[str, Any]:
        """Process progress camera data"""
        return {
            'completion_percentage': data.get('completion_percentage', 0),
            'quality_score': data.get('quality_score', 0),
            'issues_detected': data.get('issues_detected', []),
            'photos_captured': data.get('photos_captured', 0),
            'time_lapse_status': data.get('time_lapse_status', 'inactive')
        }
    
    def _process_generic_data(self, device: IoTDevice, data: Dict) -> Dict[str, Any]:
        """Process generic device data"""
        return {
            'raw_data': data,
            'processed_at': datetime.now().isoformat(),
            'device_health': 'good'
        }
    
    async def get_iot_dashboard_data(self) -> Dict[str, Any]:
        """
        Get comprehensive IoT dashboard data
        
        Returns:
            Dict containing all IoT device statuses and analytics
        """
        try:
            device_summary = {}
            alerts = []
            analytics = {}
            
            for device_id, device in self.iot_devices.items():
                # Device summary
                device_summary[device_id] = {
                    'type': device.device_type,
                    'location': device.location,
                    'status': device.status,
                    'last_update': device.last_update.isoformat(),
                    'battery_level': device.battery_level,
                    'signal_strength': device.signal_strength,
                    'data_summary': self._summarize_device_data(device)
                }
                
                # Check for alerts
                device_alerts = self._check_device_alerts(device, device.data)
                alerts.extend(device_alerts)
            
            # Generate analytics
            analytics = {
                'total_devices': len(self.iot_devices),
                'online_devices': len([d for d in self.iot_devices.values() if d.status == 'online']),
                'offline_devices': len([d for d in self.iot_devices.values() if d.status == 'offline']),
                'alert_count': len(alerts),
                'data_points_today': self._count_todays_data_points(),
                'system_health': self._calculate_system_health()
            }
            
            return {
                'device_summary': device_summary,
                'active_alerts': alerts,
                'analytics': analytics,
                'system_status': 'operational',
                'last_updated': datetime.now().isoformat()
            }
            
        except Exception as e:
            self.logger.error(f"Error getting IoT dashboard data: {str(e)}")
            return {'error': str(e)}
    
    # Integration and Communication Functions
    async def integrate_ar_iot(self, ar_session_id: str, iot_device_ids: List[str]) -> Dict[str, Any]:
        """
        Integrate AR session with IoT devices for enhanced visualization
        
        Args:
            ar_session_id: AR session identifier
            iot_device_ids: List of IoT device IDs to integrate
            
        Returns:
            Dict containing integration status and capabilities
        """
        try:
            if ar_session_id not in self.ar_sessions:
                return {'error': 'AR session not found'}
            
            ar_session = self.ar_sessions[ar_session_id]
            integrated_devices = []
            
            for device_id in iot_device_ids:
                if device_id in self.iot_devices:
                    device = self.iot_devices[device_id]
                    
                    # Configure AR-IoT integration based on device type
                    integration_config = self._configure_ar_iot_integration(device, ar_session)
                    
                    integrated_devices.append({
                        'device_id': device_id,
                        'device_type': device.device_type,
                        'integration_config': integration_config,
                        'real_time_data': device.data
                    })
            
            # Update AR session with IoT integration
            ar_session['iot_integration'] = {
                'enabled': True,
                'integrated_devices': integrated_devices,
                'real_time_overlays': True,
                'data_synchronization': True
            }
            
            return {
                'success': True,
                'integrated_devices': len(integrated_devices),
                'capabilities': self._get_integrated_capabilities(integrated_devices),
                'real_time_features': self._get_real_time_features(integrated_devices)
            }
            
        except Exception as e:
            self.logger.error(f"Error integrating AR and IoT: {str(e)}")
            return {'error': str(e)}
    
    def _configure_ar_iot_integration(self, device: IoTDevice, ar_session: Dict) -> Dict[str, Any]:
        """Configure AR-IoT integration based on device type"""
        integrations = {
            'environmental_sensor': {
                'ar_overlays': ['temperature_heatmap', 'humidity_zones', 'air_quality_indicators'],
                'real_time_updates': True,
                'alert_visualization': True,
                'data_logging': True
            },
            'security_camera': {
                'ar_overlays': ['live_feed_overlay', 'motion_tracking', 'object_highlights'],
                'recording_integration': True,
                'alert_visualization': True,
                'privacy_controls': True
            },
            'tool_tracker': {
                'ar_overlays': ['tool_location_markers', 'usage_status', 'maintenance_alerts'],
                'inventory_management': True,
                'usage_analytics': True,
                'theft_prevention': True
            },
            'safety_monitor': {
                'ar_overlays': ['safety_zones', 'hazard_warnings', 'compliance_status'],
                'emergency_integration': True,
                'training_mode': True,
                'incident_reporting': True
            },
            'progress_camera': {
                'ar_overlays': ['progress_comparison', 'quality_indicators', 'completion_tracking'],
                'time_lapse_integration': True,
                'client_sharing': True,
                'documentation_automation': True
            }
        }
        
        return integrations.get(device.device_type, {
            'basic_integration': True,
            'status_overlay': True,
            'data_display': True
        })
    
    # Helper Functions
    def setup_iot_monitoring(self):
        """Setup IoT device monitoring system"""
        self.logger.info("IoT monitoring system initialized")
    
    def setup_ar_engine(self):
        """Setup AR visualization engine"""
        self.logger.info("AR visualization engine initialized")
    
    def setup_real_time_communication(self):
        """Setup real-time communication for AR and IoT"""
        self.logger.info("Real-time communication system initialized")
    
    async def _get_job_data(self, job_id: str) -> Dict[str, Any]:
        """Get job data for AR visualization"""
        # Mock job data - in real implementation, this would fetch from database
        return {
            'job_id': job_id,
            'job_type': 'bathroom_renovation',
            'specifications': {},
            'tasks': [],
            'materials': [],
            'timeline': {}
        }
    
    def _generate_ar_qr_code(self, session_id: str) -> str:
        """Generate QR code data for AR session"""
        return f"contractorai://ar/{session_id}"
    
    def _get_ar_instructions(self, job_type: str) -> List[str]:
        """Get AR setup instructions for job type"""
        return [
            "1. Point your device camera at the work area",
            "2. Wait for AR calibration to complete",
            "3. Follow on-screen instructions for measurements",
            "4. Take progress photos at marked checkpoints"
        ]
    
    def _calculate_ar_completion(self, session: Dict) -> float:
        """Calculate completion percentage for AR session"""
        # Mock calculation - real implementation would analyze progress data
        return 75.0
    
    def _assess_ar_quality(self, session: Dict) -> Dict[str, Any]:
        """Assess quality based on AR measurements and photos"""
        return {
            'overall_score': 92,
            'measurement_accuracy': 95,
            'progress_consistency': 89,
            'quality_indicators': ['good_alignment', 'proper_spacing', 'clean_work']
        }
    
    def _get_next_ar_steps(self, session: Dict) -> List[str]:
        """Get next steps for AR session"""
        return [
            "Complete final tile grouting",
            "Install remaining fixtures",
            "Conduct quality inspection",
            "Take completion photos"
        ]
    
    async def _broadcast_ar_update(self, session_id: str, update_data: Dict):
        """Broadcast AR update to connected clients"""
        # Implementation would use WebSocket connections
        pass
    
    async def _setup_device_monitoring(self, device: IoTDevice):
        """Setup monitoring for specific device"""
        # Implementation would configure device-specific monitoring
        pass
    
    def _generate_device_endpoints(self, device_id: str) -> Dict[str, str]:
        """Generate API endpoints for device"""
        return {
            'data_endpoint': f'/api/iot/{device_id}/data',
            'control_endpoint': f'/api/iot/{device_id}/control',
            'status_endpoint': f'/api/iot/{device_id}/status'
        }
    
    def _check_device_alerts(self, device: IoTDevice, data: Dict) -> List[Dict[str, Any]]:
        """Check for device alerts based on data"""
        alerts = []
        
        # Battery level alert
        if device.battery_level and device.battery_level < 20:
            alerts.append({
                'type': 'battery_low',
                'severity': 'medium',
                'message': f'Device {device.device_id} battery level is {device.battery_level}%',
                'timestamp': datetime.now().isoformat()
            })
        
        # Device offline alert
        time_since_update = datetime.now() - device.last_update
        if time_since_update > timedelta(minutes=10):
            alerts.append({
                'type': 'device_offline',
                'severity': 'high',
                'message': f'Device {device.device_id} has been offline for {time_since_update}',
                'timestamp': datetime.now().isoformat()
            })
        
        return alerts
    
    async def _trigger_device_automation(self, device: IoTDevice, data: Dict, alerts: List) -> List[Dict[str, Any]]:
        """Trigger automation based on device data and alerts"""
        actions = []
        
        # Example automation triggers
        if alerts:
            for alert in alerts:
                if alert['type'] == 'battery_low':
                    actions.append({
                        'action': 'schedule_battery_replacement',
                        'device_id': device.device_id,
                        'priority': 'medium'
                    })
                elif alert['type'] == 'device_offline':
                    actions.append({
                        'action': 'notify_technician',
                        'device_id': device.device_id,
                        'priority': 'high'
                    })
        
        return actions
    
    def _determine_device_status(self, device: IoTDevice, data: Dict) -> str:
        """Determine device status based on data"""
        time_since_update = datetime.now() - device.last_update
        
        if time_since_update > timedelta(minutes=10):
            return 'offline'
        elif device.battery_level and device.battery_level < 10:
            return 'low_battery'
        else:
            return 'online'
    
    def _summarize_device_data(self, device: IoTDevice) -> Dict[str, Any]:
        """Summarize device data for dashboard"""
        return {
            'last_reading': device.data,
            'data_points_today': 144,  # Mock data
            'average_values': {},  # Mock data
            'trends': 'stable'  # Mock data
        }
    
    def _count_todays_data_points(self) -> int:
        """Count data points received today"""
        return len(self.iot_devices) * 144  # Mock: 144 readings per device per day
    
    def _calculate_system_health(self) -> float:
        """Calculate overall system health score"""
        if not self.iot_devices:
            return 100.0
        
        online_devices = len([d for d in self.iot_devices.values() if d.status == 'online'])
        return (online_devices / len(self.iot_devices)) * 100
    
    def _get_integrated_capabilities(self, devices: List) -> List[str]:
        """Get capabilities from integrated devices"""
        capabilities = set()
        for device in devices:
            device_type = device['device_type']
            if device_type == 'environmental_sensor':
                capabilities.update(['temperature_monitoring', 'humidity_tracking', 'air_quality'])
            elif device_type == 'security_camera':
                capabilities.update(['live_monitoring', 'motion_detection', 'recording'])
            elif device_type == 'tool_tracker':
                capabilities.update(['asset_tracking', 'usage_monitoring', 'theft_prevention'])
        
        return list(capabilities)
    
    def _get_real_time_features(self, devices: List) -> List[str]:
        """Get real-time features from integrated devices"""
        return [
            'live_data_overlay',
            'real_time_alerts',
            'automatic_documentation',
            'progress_tracking',
            'quality_monitoring'
        ]

