from odoo import fields, models, api


class HrEmployee(models.Model):
    """Inherit the model to add field"""
    _inherit = 'hr.employee'

    device_id_num = fields.Char(string='Biometric Device ID',
                                help="Give the biometric device id")
    shift_id = fields.Many2one('hs.shifts',string="Time Shift")

    @api.model_create_multi
    def create(self, vals_list):
        employees = super(HrEmployee, self).create(vals_list)
        for employee in employees:
            if not employee.device_id_num:
                employee.device_id_num = str(employee.id)
        return employees
