# -*- coding: utf-8 -*-
import datetime
import logging
from collections import defaultdict

import pytz

from odoo import fields, models, _, api
from odoo.exceptions import UserError, ValidationError
from datetime import datetime, timedelta, time


_logger = logging.getLogger(__name__)
try:
    from zk import ZK, const
except ImportError:
    _logger.error("Please Install pyzk library.")


class BiometricDeviceDetails(models.Model):
    """Model for configuring and connect the biometric device with odoo"""
    _name = 'biometric.device.details'
    _description = 'Biometric Device Details'

    name = fields.Char(string='Name', required=True, help='Record Name')
    device_ip = fields.Char(string='Device IP', required=True,
                            help='The IP address of the Device')
    port_number = fields.Integer(string='Port Number 1', required=True, default=4370,
                                 help="The Port Number of the Device")
    port_number2 = fields.Integer(string='Port Number 2', required=True, default=0,
                                  help="The Port Number of the Device")
    port_number3 = fields.Integer(string='Port Number 3', required=True, default=0,
                                  help="The Port Number of the Device")
    comm_key = fields.Integer(string='Comm Key (Password)', default=0, help="Communication key set in the device network settings (usually 0 if not set)")
    company_id = fields.Many2one('res.company', string='Company',
                                 default=lambda self: self.env.company,
                                 help='Current Company')
    date_to = fields.Date(string="Date To", default=fields.Date.today)
    date_from = fields.Date(string="Date From", default=fields.Date.today)
    enrollment_voice_index = fields.Integer(string='Enrollment Sound', default=20)
    download_sound_index = fields.Integer(string='Download Sound', default=0)
    fetch_users_sound_index = fields.Integer(string='Fetch Users Sound', default=0)
    restart_sound_index = fields.Integer(string='Restart Sound', default=0)
    test_beep_sound_index = fields.Integer(string='Test Beep Sound', default=0)
    push_user_sound_index = fields.Integer(string='Push User Sound', default=0)
    delete_user_sound_index = fields.Integer(string='Delete User Sound', default=0)
    mute_sounds = fields.Boolean(string='Mute All Sounds', default=False)
    
    mute_enrollment = fields.Boolean(string='Mute Enrollment', default=False)
    mute_download = fields.Boolean(string='Mute Download', default=False)
    mute_fetch_users = fields.Boolean(string='Mute Fetch Users', default=False)
    mute_restart = fields.Boolean(string='Mute Restart', default=False)
    mute_test_beep = fields.Boolean(string='Mute Test Beep', default=False)
    mute_push_user = fields.Boolean(string='Mute Push User', default=False)
    mute_delete_user = fields.Boolean(string='Mute Delete User', default=False)

    # Attendance Settings
    shift_start = fields.Float(string='Standard Start Time', default=8.0, help="e.g., 8:00 AM")
    shift_end = fields.Float(string='Standard End Time', default=17.0, help="e.g., 5:00 PM")
    resource_calendar_id = fields.Many2one('resource.calendar', string='Working Schedule', 
                                           help="Automatically generated/linked schedule")
    max_shift_hours = fields.Float(string='Max Shift Duration (Hours)', default=16, 
                                   help="Punches beyond this gap will be treated as a new check-in")
    
    @api.onchange('shift_start', 'shift_end', 'name')
    def _onchange_shift_times(self):
        """Automatically create/update a resource calendar based on simple times"""
        if self.shift_start or self.shift_end:
            calendar_name = f"Schedule for {self.name or 'Device'}"
            if not self.resource_calendar_id:
                # Create a new calendar if it doesn't exist
                calendar = self.env['resource.calendar'].create({
                    'name': calendar_name,
                    'company_id': self.company_id.id or self.env.company.id,
                })
                self.resource_calendar_id = calendar.id
            else:
                self.resource_calendar_id.name = calendar_name
            
            # Clear existing attendance lines and create new ones for Mon-Fri (or Sat-Thu if preferred)
            # For simplicity, we'll set Mon-Fri. You can adjust this logic.
            self.resource_calendar_id.attendance_ids.unlink()
            lines = []
            for day in ['0', '1', '2', '3', '4']: # Mon to Fri
                lines.append((0, 0, {
                    'name': 'Morning',
                    'dayofweek': day,
                    'hour_from': self.shift_start,
                    'hour_to': self.shift_end,
                    'day_period': 'morning',
                }))
            self.resource_calendar_id.write({'attendance_ids': lines})

    def device_connect(self, zk):
        """Function for connecting the device with Odoo"""
        try:
            conn = zk.connect()
            return conn
        except Exception as e:
            _logger.error(f"Biometric Connection Error: {e}")
            raise ValidationError(
                f"Network Error: {e}. Please check if the device is online and the IP {self.device_ip} is correct.")

    @api.model
    def cron_download_attendance(self):
        """cron_download method: Perform a cron job to download attendance data and sync fingerprints."""
        _logger.info("++++++++++++Cron Executed (Real-time Sync)++++++++++++++++++++++")
        machines = self.env['biometric.device.details'].search([])
        for machine in machines:
            # Sync attendance logs
            machine.with_context(cron_sync=True).action_download_attendance()
            # Sync fingerprints status automatically every minute
            try:
                machine.action_sync_all_fingerprints()
            except:
                _logger.warning(f"Could not sync fingerprints for machine {machine.name} in cron.")

    def action_test_connection(self):
        """Checking the connection status for the primary port"""
        if not self.port_number:
            raise ValidationError("Please provide Port Number 1.")

        zk = ZK(self.device_ip, port=self.port_number,
                timeout=30, password=self.comm_key, ommit_ping=True)
        try:
            conn = zk.connect()
            if conn:
                conn.disconnect()
                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'message': f'Successfully connected to {self.device_ip}:{self.port_number}',
                        'type': 'success',
                        'sticky': False
                    }
                }
        except Exception as e:
            raise ValidationError(f"Failed to connect: {e}")

    def action_download_attendance(self):
        """Function to download attendance records from the device"""
        zk_attendance = self.env['zk.machine.attendance']
        hr_attendance = self.env['hr.attendance']

        for info in self:
            machine_ip = info.device_ip
            ports = [info.port_number, info.port_number2, info.port_number3]

            all_attendance = []
            active_connections = []

            timeout = 10 if self.env.context.get('cron_sync') else 30
            for p in ports:
                if p > 0:
                    try:
                        zk = ZK(machine_ip, port=p, timeout=timeout,
                                password=info.comm_key, force_udp=False, ommit_ping=True)
                        conn = self.device_connect(zk)
                        if conn:
                            # Play sound if not muted globally and not muted specifically
                            if not info.mute_sounds and not info.mute_download:
                                try:
                                    conn.test_voice(info.download_sound_index)
                                except:
                                    pass
                            conn.disable_device()
                            all_attendance.extend(conn.get_attendance())
                            active_connections.append(conn)
                    except Exception as e:
                        _logger.warning(f"Could not connect to port {p}: {e}")

            if all_attendance:
                attendance_dict = defaultdict(list)
                # If running via cron, sync from yesterday to today to ensure no logs are missed
                if self.env.context.get('cron_sync'):
                    end_date = fields.Date.today()
                    start_date = end_date - timedelta(days=1)
                else:
                    start_date = min(info.date_to, info.date_from)
                    end_date = max(info.date_to, info.date_from)

                for each in all_attendance:
                    atten_time = each.timestamp
                    local_tz = pytz.timezone(self.env.user.tz or 'GMT')
                    local_dt = local_tz.localize(atten_time, is_dst=None)
                    utc_dt = local_dt.astimezone(pytz.utc)

                    # Work with UTC datetime objects
                    atten_time_utc = utc_dt.replace(tzinfo=None)
                    atten_date = atten_time_utc.date()

                    if start_date <= atten_date <= end_date:
                        attendance_dict[each.user_id].append(atten_time_utc)

                if not attendance_dict:
                    # Clear connections before raising error
                    for c in active_connections:
                        try:
                            c.enable_device()
                            c.disconnect()
                        except:
                            pass
                    raise UserError(
                        _('Connection successful, but no data found for the selected date range.'))

                created_count = 0
                unmatched_ids = set()
                for user_id, atten_times in attendance_dict.items():
                    # Search for employee by Biometric ID or Database ID
                    user_id_str = str(user_id)
                    employee = self.env['hr.employee'].search([
                        '|',
                        ('device_id_num', '=', user_id_str),
                        ('id', '=', int(user_id_str) if user_id_str.isdigit() else 0)
                    ], limit=1)
                    if employee:
                        atten_times.sort()
                        for t in atten_times:
                            exists = zk_attendance.search([
                                ('device_id_num', '=', str(user_id)),
                                ('check_in', '=', t)
                            ], limit=1)

                            if not exists:
                                # Smart logic for Odoo hr.attendance
                                # First, check if this EXACT attendance record already exists in Odoo to avoid duplicates
                                odoo_exists = hr_attendance.search([
                                    ('employee_id', '=', employee.id),
                                    ('check_in', '=', t)
                                ], limit=1)

                                if not odoo_exists:
                                    try:
                                        last_attendance = hr_attendance.search([
                                            ('employee_id', '=', employee.id),
                                            ('check_out', '=', False)
                                        ], limit=1, order='check_in desc')

                                        if last_attendance:
                                            # Smart Gap Check: Use the configurable max_shift_hours
                                            max_gap = self.max_shift_hours or 16
                                            time_diff = t - last_attendance.check_in
                                            if 0 < time_diff.total_seconds() < max_gap * 3600:
                                                last_attendance.write({'check_out': t})
                                            else:
                                                # Gap too large, start a new record instead of pairing
                                                hr_attendance.create({
                                                    'employee_id': employee.id,
                                                    'check_in': t,
                                                })
                                        else:
                                            hr_attendance.create({
                                                'employee_id': employee.id,
                                                'check_in': t,
                                            })
                                    except:
                                        # If Odoo still complains about duplicates, we just skip it
                                        pass

                                # Always create the raw log if it doesn't exist in zk_attendance
                                zk_attendance.create({
                                    'employee_id': employee.id,
                                    'device_id_num': str(user_id),
                                    'check_in': t,
                                    'i_check': 'i',
                                })
                                created_count += 1
                    else:
                        unmatched_ids.add(str(user_id))

                # Enable and disconnect
                for c in active_connections:
                    try:
                        c.enable_device()
                        c.disconnect()
                    except:
                        pass

                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': _('Success'),
                        'message': _(f'Successfully synchronized {created_count} records.'),
                        'type': 'success',
                        'sticky': False
                    }
                }
            else:
                for c in active_connections:
                    try:
                        c.enable_device()
                        c.disconnect()
                    except:
                        pass
                raise UserError(_('No records retrieved from the device.'))

    def action_set_dates_to_today(self):
        """Reset sync dates to today's date"""
        for rec in self:
            rec.write({
                'date_from': fields.Date.today(),
                'date_to': fields.Date.today()
            })
        return True

    def action_clear_attendance_log(self):
        """Method to clear all attendance logs from the device"""
        self.ensure_one()
        zk = ZK(self.device_ip, port=self.port_number,
                timeout=30, password=self.comm_key, ommit_ping=True)
        try:
            conn = self.device_connect(zk)
            if conn:
                conn.disable_device()
                try:
                    conn.clear_attendance()
                finally:
                    conn.enable_device()
                    conn.disconnect()
                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': _('Logs Cleared'),
                        'message': _('All attendance logs have been deleted from the device.'),
                        'type': 'warning',
                        'sticky': False
                    }
                }
        except Exception as e:
            raise ValidationError(f"Failed to clear logs: {e}")

    def action_test_live_capture(self):
        """Temporary method to check if the device and library support Live Capture"""
        self.ensure_one()
        zk = ZK(self.device_ip, port=self.port_number, timeout=10, password=0, force_udp=False, ommit_ping=True)
        try:
            conn = zk.connect()
            if conn:
                # Check if the generator method exists and works
                try:
                    capture = conn.live_capture()
                    # We won't actually loop here to avoid blocking, 
                    # just checking if the call is valid
                    conn.disconnect()
                    return {
                        'type': 'ir.actions.client',
                        'tag': 'display_notification',
                        'params': {
                            'title': _('Live Capture Test'),
                            'message': _('Great! Your device and the pyzk library support Live Capture. This means we can potentially sync fingerprints instantly.'),
                            'type': 'success',
                            'sticky': True
                        }
                    }
                except Exception as inner_e:
                    conn.disconnect()
                    raise ValidationError(f"Device connected but Live Capture failed: {inner_e}")
        except Exception as e:
            raise ValidationError(f"Could not connect to device: {e}")

    def action_restart_device(self):
        """For restarting the device"""
        zk = ZK(self.device_ip, port=self.port_number,
                timeout=30, password=self.comm_key, ommit_ping=True)
        try:
            conn = self.device_connect(zk)
            if conn:
                if not self.mute_sounds and not self.mute_restart:
                    try:
                        conn.test_voice(self.restart_sound_index)
                    except:
                        pass
                conn.restart()
                conn.disconnect()
        except Exception as error:
            raise ValidationError(f'Error: {error}')

    def action_fetch_users(self):
        """Fetch all users from the device and save them in Odoo"""
        self.ensure_one()
        zk = ZK(self.device_ip, port=self.port_number,
                timeout=30, password=self.comm_key, ommit_ping=True)
        try:
            conn = zk.connect()
            if conn:
                if not self.mute_sounds and not self.mute_fetch_users:
                    try:
                        conn.test_voice(self.fetch_users_sound_index)
                    except:
                        pass
                conn.disable_device()
                device_users = conn.get_users()
                
                # Fetch all templates (fingerprints) to sync status
                try:
                    templates = conn.get_templates()
                    finger_map = defaultdict(list)
                    for t in templates:
                        uid_key = str(getattr(t, 'user_id', None) or t.uid)
                        finger_map[uid_key].append(str(t.fid + 1))
                except:
                    finger_map = {}
                
                user_model = self.env['biometric.device.user']

                count = 0
                for user in device_users:
                    # Check if user already exists
                    existing_user = user_model.search([
                        ('device_id', '=', str(user.user_id)),
                        ('device_details_id', '=', self.id)
                    ], limit=1)

                    vals = {
                        'name': user.name,
                        'device_id': str(user.user_id),
                        'user_id_num': user.uid,
                        'privilege': str(user.privilege),
                        'password': user.password,
                        'group_id': str(user.group_id),
                        'device_details_id': self.id,
                        'registered_fingers': ", ".join(sorted(list(set(finger_map.get(str(user.user_id), []))), key=int)),
                    }

                    if existing_user:
                        existing_user.write(vals)
                    else:
                        user_model.create(vals)
                        count += 1

                conn.enable_device()
                conn.disconnect()
                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': _('Success'),
                        'message': _(f'Successfully fetched {len(device_users)} users ({count} new).'),
                        'type': 'success',
                    }
                }
        except Exception as e:
            raise ValidationError(f"Error fetching users: {e}")

    def action_sync_all_fingerprints(self):
        """Fetch all templates from device and update registered fingers for all users on this device"""
        self.ensure_one()
        zk = ZK(self.device_ip, port=self.port_number, timeout=30, password=self.comm_key, ommit_ping=True)
        try:
            conn = zk.connect()
            if conn:
                templates = conn.get_templates()
                finger_map = defaultdict(list)
                for t in templates:
                    uid_key = str(getattr(t, 'user_id', None) or t.uid)
                    finger_map[uid_key].append(str(t.fid + 1))
                
                device_users = self.env['biometric.device.user'].search([('device_details_id', '=', self.id)])
                for d_user in device_users:
                    f_list = finger_map.get(str(d_user.device_id), [])
                    if not f_list and d_user.user_id_num:
                        f_list = finger_map.get(str(d_user.user_id_num), [])
                    d_user.registered_fingers = ", ".join(sorted(list(set(f_list)), key=int)) if f_list else ""

                conn.disconnect()
                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': _('Sync Complete'),
                        'message': _(f'Updated fingerprints for {len(device_users)} users.'),
                        'type': 'success',
                    }
                }
        except Exception as e:
            raise ValidationError(f"Fingerprint sync failed: {e}")

    def action_play_sound_by_index(self, index=0):
        """Play a specific sound index (used by the UI buttons)"""
        self.ensure_one()
        zk = ZK(self.device_ip, port=self.port_number, timeout=30, password=self.comm_key, ommit_ping=True)
        try:
            conn = zk.connect()
            if conn:
                # Get index from context if available
                idx = int(self.env.context.get('sound_idx', index))
                conn.test_voice(idx)
                conn.disconnect()
        except Exception as e:
            raise ValidationError(f"Failed to play sound: {e}")


class BiometricDeviceUser(models.Model):
    _name = 'biometric.device.user'
    _description = 'Biometric Device User'

    _sql_constraints = [
        ('device_user_unique', 'unique(device_id, device_details_id)', 
         'This User ID is already registered for this device!')
    ]

    name = fields.Char(string='Name', required=True)
    employee_id = fields.Many2one('hr.employee', string='Related Employee', help="Link this device user to an Odoo employee")
    device_id = fields.Char(string='Device ID (User ID)', required=True)
    user_id_num = fields.Integer(string='UID', help="Unique ID on the device")
    privilege = fields.Selection([
        ('0', 'User'),
        ('14', 'Admin'),
    ], string='Privilege', default='0')
    password = fields.Char(string='Password')
    group_id = fields.Char(string='Group ID', default='1')

    @api.onchange('employee_id')
    def _onchange_employee_id(self):
        if self.employee_id:
            self.name = self.employee_id.name
            # Smart Fallback: Use 'device_id_num' if it exists, otherwise use the Employee's Database ID
            val_to_use = self.employee_id.device_id_num or str(self.employee_id.id)
            if val_to_use:
                self.device_id = val_to_use
                try:
                    self.user_id_num = int(val_to_use)
                except:
                    self.user_id_num = 0
            else:
                self.device_id = ''
                self.user_id_num = 0
        else:
            self.name = ''
            self.device_id = ''
            self.user_id_num = 0

    @api.onchange('device_id')
    def _onchange_device_id(self):
        """Automatically sync UID with Device ID if it's a number"""
        if self.device_id:
            try:
                self.user_id_num = int(self.device_id)
            except:
                pass
    finger_index = fields.Selection([
        ('0', '[1] Right Thumb'),
        ('1', '[2] Right Index'),
        ('2', '[3] Right Middle'),
        ('3', '[4] Right Ring'),
        ('4', '[5] Right Little'),
        ('5', '[6] Left Thumb'),
        ('6', '[7] Left Index'),
        ('7', '[8] Left Middle'),
        ('8', '[9] Left Ring'),
        ('9', '[10] Left Little'),
    ], string='Finger to Enroll', default='0')
    registered_fingers = fields.Char(string='Registered Fingers', readonly=True, help="List of finger indices already registered on the device for this user")
    fingers_status_html = fields.Html(string='Fingers Status', compute='_compute_fingers_status_html')
    device_details_id = fields.Many2one(
        'biometric.device.details', string='Device', required=True)

    @api.depends('registered_fingers')
    def _compute_fingers_status_html(self):
        for rec in self:
            registered = (rec.registered_fingers or "").split(", ")
            html = '<div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px;">'
            for i in range(1, 11):
                is_ok = str(i) in registered
                bg_color = "#28a745" if is_ok else "#e9ecef"
                text_color = "white" if is_ok else "#6c757d"
                label = f"F{i} OK" if is_ok else f"F{i}"
                border = "none" if is_ok else "1px solid #ced4da"
                
                html += f'''
                    <div style="
                        background-color: {bg_color}; 
                        color: {text_color}; 
                        padding: 4px 10px; 
                        border-radius: 20px; 
                        font-size: 12px; 
                        font-weight: bold;
                        border: {border};
                        display: flex;
                        align-items: center;
                        gap: 5px;
                    ">
                        {label}
                    </div>
                '''
            html += '</div>'
            rec.fingers_status_html = html

    def action_push_to_device(self):
        """Upload this user to the physical device"""
        self.ensure_one()
        device = self.device_details_id
        zk = ZK(device.device_ip, port=device.port_number,
                timeout=30, password=device.comm_key, ommit_ping=True)
        try:
            conn = zk.connect()
            if conn:
                if not device.mute_sounds and not device.mute_push_user:
                    try:
                        conn.test_voice(device.push_user_sound_index)
                    except:
                        pass
                conn.disable_device()
                # Set user on device
                # Note: uid must be int, user_id must be string.
                # name and password must be strings. group_id is often expected as a string in some pyzk versions.
                conn.set_user(
                    uid=int(self.user_id_num or 0),
                    name=str(self.name or ''),
                    privilege=int(self.privilege or 0),
                    password=str(self.password or ''),
                    group_id=str(self.group_id or '1'),
                    user_id=str(self.device_id)
                )
                conn.enable_device()
                conn.disconnect()
                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': _('Success'),
                        'message': _(f'User {self.name} pushed to device successfully.'),
                        'type': 'success',
                    }
                }
        except Exception as e:
            raise ValidationError(f"Error pushing user: {e}")

    def action_enroll_fingerprint(self):
        """Send command to device to start fingerprint enrollment for this user"""
        self.ensure_one()
        device = self.device_details_id
        zk = ZK(device.device_ip, port=device.port_number,
                timeout=30, password=device.comm_key, ommit_ping=True)
        try:
            conn = zk.connect()
            if conn:
                conn.disable_device()
                try:
                    # Cancel any active capture or operation first
                    conn.cancel_capture()
                    
                    # Play the voice prompt if not muted
                    if not device.mute_sounds and not device.mute_enrollment:
                        try:
                            conn.test_voice(device.enrollment_voice_index) 
                        except:
                            pass

                    # Validate UID
                    uid_to_use = int(self.user_id_num or 0)
                    if uid_to_use == 0:
                        try:
                            uid_to_use = int(self.device_id)
                        except:
                            raise ValidationError(_("UID cannot be 0. Please enter a unique number."))
                    
                    try:
                        conn.set_user(
                            uid=uid_to_use,
                            name=str(self.name or ''),
                            privilege=int(self.privilege or 0),
                            password=str(self.password or ''),
                            group_id=str(self.group_id or '1'),
                            user_id=str(self.device_id)
                        )
                    except Exception as set_user_e:
                        _logger.warning(f"Set user failed during enrollment: {set_user_e}")
                    
                    conn.enroll_user(uid=uid_to_use, temp_id=int(self.finger_index))
                finally:
                    conn.enable_device()
                    conn.disconnect()
                
                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': _('Enrollment Started'),
                        'message': _(f'The device is now waiting for {self.name} to place finger 3 times.'),
                        'type': 'success',
                        'sticky': True,
                        'next': {'type': 'ir.actions.client', 'tag': 'reload'}
                    }
                }
        except Exception as e:
            error_msg = str(e)
            if 'password' in error_msg.lower():
                friendly_error = "Connection Failed: Incorrect Comm Key. Please check device settings."
            elif 'can\'t enroll' in error_msg.lower():
                friendly_error = "Device Rejected: This finger slot might be full or the user exists. Try deleting the finger first."
            else:
                friendly_error = f"Device Error: {error_msg}"
            
            raise ValidationError(friendly_error)

    def action_push_to_device(self):
        """Push this user to the device"""
        self.ensure_one()
        device = self.device_details_id
        zk = ZK(device.device_ip, port=device.port_number,
                timeout=30, password=device.comm_key, ommit_ping=True)
        try:
            conn = zk.connect()
            if conn:
                if not device.mute_sounds and not device.mute_push_user:
                    try:
                        conn.test_voice(device.push_user_sound_index)
                    except:
                        pass
                
                # Check if we should use user_id_num or device_id
                uid_to_use = int(self.user_id_num or self.device_id)
                user_id_str = str(self.device_id)
                
                # Push the user with safe string casting to avoid TypeError
                conn.set_user(
                    uid=uid_to_use, 
                    name=str(self.name or ''), 
                    privilege=int(self.privilege or 0), 
                    password=str(self.password or ''), 
                    group_id=str(self.group_id or '1'), 
                    user_id=str(self.device_id)
                )
                
                conn.disconnect()
                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': _('Success'),
                        'message': _(f'User {self.name} has been pushed to the device.'),
                        'type': 'success',
                    }
                }
        except Exception as e:
            error_msg = str(e)
            friendly_error = f"خطأ في الجهاز: {error_msg}"
            if 'password' in error_msg.lower() or 'comm' in error_msg.lower():
                friendly_error = "فشل الاتصال: كلمة مرور الجهاز (Comm Key) خاطئة."
            elif 'already exists' in error_msg.lower():
                friendly_error = "هذا المستخدم موجود مسبقاً في الجهاز بنفس الرقم."
            
            raise ValidationError(friendly_error)

    def action_delete_fingerprint(self):
        """Delete the specific finger template from the device"""
        self.ensure_one()
        device = self.device_details_id
        zk = ZK(device.device_ip, port=device.port_number,
                timeout=30, password=device.comm_key, ommit_ping=True)
        try:
            conn = zk.connect()
            if conn:
                if not device.mute_sounds and not device.mute_delete_user:
                    try:
                        conn.test_voice(device.delete_user_sound_index)
                    except:
                        pass
                
                conn.disable_device()
                try:
                    # Delete specific template
                    # uid must be int, temp_id (finger index) must be int
                    uid_to_use = int(self.user_id_num or self.device_id)
                    conn.delete_user_template(uid=uid_to_use, temp_id=int(self.finger_index))
                finally:
                    conn.enable_device()
                    conn.disconnect()
                
                # Update local status
                self.action_fetch_remote_fingerprints()
                
                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': _('Finger Deleted'),
                        'message': _(f'Fingerprint index {int(self.finger_index)+1} has been removed from the device.'),
                        'type': 'warning',
                        'next': {'type': 'ir.actions.client', 'tag': 'reload'}
                    }
                }
        except Exception as e:
            raise ValidationError(f"Failed to delete finger: {e}")

    def action_test_beep(self):
        """Send a beep command to the device to verify it's receiving commands"""
        self.ensure_one()
        device = self.device_details_id
        zk = ZK(device.device_ip, port=device.port_number,
                timeout=30, password=device.comm_key, ommit_ping=True)
        try:
            conn = zk.connect()
            if conn:
                if not device.mute_sounds and not device.mute_test_beep:
                    try:
                        conn.test_voice(device.test_beep_sound_index)
                    except:
                        pass
                conn.test_voice(0) # 0 is the default beep/voice test
                conn.disconnect()
                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': _('Test Successful'),
                        'message': _('The device should have beeped. This confirms communication is working.'),
                        'type': 'success',
                    }
                }
        except Exception as e:
            raise ValidationError(f"Beep test failed: {e}")

    def action_fetch_remote_fingerprints(self):
        """Fetch all templates from device and update registered fingers for this user"""
        self.ensure_one()
        device = self.device_details_id
        zk = ZK(device.device_ip, port=device.port_number,
                timeout=30, password=device.comm_key, ommit_ping=True)
        try:
            conn = zk.connect()
            if conn:
                templates = conn.get_templates()
                # Filter templates for this user
                uid_to_match = int(self.user_id_num or 0)
                device_id_str = str(self.device_id)
                
                user_fids = []
                for t in templates:
                    # Some devices use internal UID (int), others use User ID (string)
                    # We check both to be sure
                    match_uid = (t.uid == uid_to_match and uid_to_match != 0)
                    match_user_id = (getattr(t, 'user_id', None) == device_id_str)
                    
                    if match_uid or match_user_id:
                        # Convert 0-indexed to 1-indexed for display to match the UI
                        user_fids.append(str(t.fid + 1))
                
                if user_fids:
                    # Remove duplicates and sort
                    unique_fids = sorted(list(set(user_fids)), key=int)
                    self.registered_fingers = ", ".join(unique_fids)
                else:
                    self.registered_fingers = "No fingers found"
                
                conn.disconnect()
                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': _('Update Successful'),
                        'message': _(f'Found {len(user_fids)} registered fingers for this user.'),
                        'type': 'success',
                        'next': {'type': 'ir.actions.client', 'tag': 'reload'}
                    }
                }
        except Exception as e:
            raise ValidationError(f"Failed to fetch fingerprints: {e}")

    def action_delete_from_device(self):
        """Delete this user from the physical device"""
        self.ensure_one()
        device = self.device_details_id
        zk = ZK(device.device_ip, port=device.port_number,
                timeout=30, password=device.comm_key, ommit_ping=True)
        try:
            conn = zk.connect()
            if conn:
                if not device.mute_sounds and not device.mute_delete_user:
                    try:
                        conn.test_voice(device.delete_user_sound_index)
                    except:
                        pass
                conn.disable_device()
                conn.delete_user(uid=self.user_id_num,
                                 user_id=str(self.device_id))
                conn.enable_device()
                conn.disconnect()
                self.unlink()
                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': _('Deleted'),
                        'message': _(f'User deleted from device and Odoo.'),
                        'type': 'warning',
                    }
                }
        except Exception as e:
            raise ValidationError(f"Error deleting user: {e}")
