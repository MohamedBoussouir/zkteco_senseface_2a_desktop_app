# -*- coding: utf-8 -*-
from odoo import fields, models, tools


class DailyAttendance(models.Model):
    """Model to hold data from the biometric device"""
    _name = 'daily.attendance'
    _description = 'Daily Attendance Report'
    _auto = False
    _order = 'punching_day desc'

    employee_id = fields.Many2one('hr.employee', string='Employee',
                                  help='Employee Name')
    device_id_num = fields.Char(string="Password")
    punching_day = fields.Datetime(string='Date', help='Date of punching')
    check_in = fields.Datetime(string='Check In')
    check_out = fields.Datetime(string='Check Out')
    i_check = fields.Char(string="Check Type")
    o_check = fields.Char(string="Check Type")
    is_danger = fields.Boolean(default=True)

    def unlink(self):
        """Allow deleting records from the source table when deleting from the view"""
        for record in self:
            # Delete from the source table using the matching criteria
            domain = [
                ('employee_id', '=', record.employee_id.id),
                ('check_in', '=', record.check_in),
                ('device_id_num', '=', record.device_id_num)
            ]
            source_records = self.env['zk.machine.attendance'].search(domain)
            source_records.unlink()
        return True

    def init(self):
        """Retrieve the data's for attendance report"""
        tools.drop_view_if_exists(self._cr, 'daily_attendance')
        query = """
            CREATE OR REPLACE VIEW daily_attendance AS (
                SELECT
                    MIN(z.id) AS id,
                    z.employee_id AS employee_id,
                    z.write_date AS punching_day,
                    z.device_id_num AS device_id_num,
                    z.check_in AS check_in,
                    z.check_out AS check_out,
                    z.i_check AS i_check,
                    z.o_check AS o_check,
                    z.is_danger AS is_danger
                FROM zk_machine_attendance z
                JOIN hr_employee e ON (z.employee_id = e.id)
                GROUP BY
                    z.employee_id,
                    z.write_date,
                    z.check_in,
                    z.check_out,
                    z.device_id_num,
                    z.i_check,
                    z.o_check,
                    z.is_danger
            )
        """

        self._cr.execute(query)
